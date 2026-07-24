import { eq } from "@repo/database";
import { db } from "@repo/database";
import {
  investigationTimelineEntriesTable,
  investigationsTable,
  type SelectInvestigation,
} from "@repo/database/schema";

import {
  parseFeatureFlagEvent,
  type FeatureFlagEventPayload,
} from "../feature-flags/webhook-parser";
import { isSignozConfigured } from "../signoz-env";
import { loadRecentInvestigationCandidates } from "./investigation-candidates";
import { insertTimelineEntry, persistChangeEvent } from "./persistence";
import { invalidatePipelineCache } from "./pipeline-cache";
import type { InvestigationContext } from "./types";

export type FeatureFlagEvent = ReturnType<typeof parseFeatureFlagEvent>;

export type FeatureFlagCorrelationResult = {
  attachedInvestigationIds: string[];
  skippedDuplicate: string[];
  refreshedInvestigationIds: string[];
  matchedBy: "time_window" | "service_match" | "flag_rollout" | "fallback_recent";
};

const DEFAULT_WINDOW_BEFORE_MS = 60 * 60 * 1000;
const DEFAULT_WINDOW_AFTER_MS = 30 * 60 * 1000;

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/[-_]+/g, "");
}

function serviceNameMatchesFlag(service: string, event: FeatureFlagEvent) {
  const serviceToken = normalizeToken(service);
  const eventToken = normalizeToken(event.service);
  const flagToken = normalizeToken(event.flagKey);
  return (
    serviceToken === eventToken ||
    serviceToken.includes(eventToken) ||
    eventToken.includes(serviceToken) ||
    serviceToken.includes(flagToken) ||
    flagToken.includes(serviceToken)
  );
}

function investigationServices(row: SelectInvestigation) {
  return [row.primaryService, ...(row.affectedServices ?? [])].filter(
    (value): value is string => Boolean(value),
  );
}

function serviceMatchesInvestigation(row: SelectInvestigation, event: FeatureFlagEvent) {
  return investigationServices(row).some((service) => serviceNameMatchesFlag(service, event));
}

export function scoreFeatureFlagMatch(
  row: SelectInvestigation,
  event: FeatureFlagEvent,
  windowBeforeMs = DEFAULT_WINDOW_BEFORE_MS,
  windowAfterMs = DEFAULT_WINDOW_AFTER_MS,
) {
  let score = 0;
  const reasons: string[] = [];

  const anchor = row.incidentWindowStart?.getTime() ?? row.createdAt.getTime();
  const eventMs = event.occurredAt.getTime();
  const inWindow = eventMs >= anchor - windowBeforeMs && eventMs <= anchor + windowAfterMs;

  if (inWindow) {
    score += 50;
    reasons.push("Feature flag change within incident window");
  }

  if (serviceMatchesInvestigation(row, event)) {
    score += 35;
    reasons.push(`Flag maps to ${event.service}`);
  }

  if (event.action === "enabled" || event.action === "rollout") {
    score += 25;
    reasons.push(`Flag ${event.action} — likely incident trigger without deploy`);
  }

  if (event.severity === "critical") {
    score += 15;
    reasons.push("High-impact flag change");
  }

  if (row.caseStatus !== "resolved") {
    score += 10;
    reasons.push("Open investigation");
  }

  return { score, inWindow, reasons };
}

export function selectFeatureFlagTargets(candidates: SelectInvestigation[], event: FeatureFlagEvent) {
  const scored = candidates
    .map((row) => ({ row, ...scoreFeatureFlagMatch(row, event) }))
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score);

  const rolloutMatches = scored.filter(
    (item) =>
      (event.action === "enabled" || event.action === "rollout") &&
      (item.inWindow || serviceMatchesInvestigation(item.row, event)),
  );
  if (rolloutMatches.length > 0) {
    return rolloutMatches.map((item) => ({
      row: item.row,
      score: item.score,
      reasons: item.reasons,
      matchedBy: serviceMatchesInvestigation(item.row, event)
        ? ("service_match" as const)
        : ("flag_rollout" as const),
    }));
  }

  const inWindow = scored.filter((item) => item.inWindow);
  if (inWindow.length > 0) {
    return inWindow.map((item) => ({
      row: item.row,
      score: item.score,
      reasons: item.reasons,
      matchedBy: serviceMatchesInvestigation(item.row, event)
        ? ("service_match" as const)
        : ("time_window" as const),
    }));
  }

  const recentOpen = candidates.find((row) => row.caseStatus !== "resolved");
  if (recentOpen) {
    const result = scoreFeatureFlagMatch(recentOpen, event);
    return [
      {
        row: recentOpen,
        score: result.score,
        reasons: [...result.reasons, "Fallback: most recent open investigation"],
        matchedBy: "fallback_recent" as const,
      },
    ];
  }

  if (candidates[0]) {
    const result = scoreFeatureFlagMatch(candidates[0], event);
    return [
      {
        row: candidates[0],
        score: result.score,
        reasons: [...result.reasons, "Fallback: most recent investigation"],
        matchedBy: "fallback_recent" as const,
      },
    ];
  }

  return [];
}

function featureFlagAlreadyAttached(
  timelineRows: Array<{ kind: string; sourceRef: unknown; metadata: unknown }>,
  fingerprint: string,
) {
  return timelineRows.some((entry) => {
    if (entry.kind !== "CHANGE") return false;
    const source = (entry as { source?: string }).source ?? "";
    if (!source.includes("feature-flag")) return false;
    const sourceRef = (entry.sourceRef ?? {}) as Record<string, unknown>;
    const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
    const existing =
      typeof sourceRef.fingerprint === "string"
        ? sourceRef.fingerprint
        : typeof metadata.fingerprint === "string"
          ? metadata.fingerprint
          : null;
    return existing === fingerprint;
  });
}

/** Feature #52 — correlate feature flag toggles into active investigations. */
export async function correlateFeatureFlagEvent(input: {
  payload: FeatureFlagEventPayload;
  organizationId?: string | null;
  ownerUserId?: string | null;
  refreshPipeline?: (investigationId: string) => Promise<void>;
}): Promise<FeatureFlagCorrelationResult> {
  const event = parseFeatureFlagEvent(input.payload);
  const candidates = await loadRecentInvestigationCandidates({
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
  });

  const targets = selectFeatureFlagTargets(candidates, event);
  const attachedInvestigationIds: string[] = [];
  const skippedDuplicate: string[] = [];
  const refreshedInvestigationIds: string[] = [];

  for (const target of targets) {
    const row = target.row;
    const timelineRows = await db
      .select()
      .from(investigationTimelineEntriesTable)
      .where(eq(investigationTimelineEntriesTable.investigationId, row.id));

    if (featureFlagAlreadyAttached(timelineRows, event.fingerprint)) {
      skippedDuplicate.push(row.id);
      continue;
    }

    const maxSort = timelineRows.reduce((max, entry) => Math.max(max, entry.sortOrder ?? 0), 0);
    const correlatedService =
      investigationServices(row).find((service) => serviceNameMatchesFlag(service, event)) ??
      event.service;

    await insertTimelineEntry({
      investigationId: row.id,
      occurredAt: event.occurredAt,
      kind: "CHANGE",
      title: event.title,
      detail: event.detail,
      source: "feature-flag-webhook",
      sourceRef: {
        provider: event.provider,
        flagKey: event.flagKey,
        flagName: event.flagName,
        action: event.action,
        environment: event.environment,
        severity: event.severity,
        fingerprint: event.fingerprint,
        correlationScore: target.score,
        matchReasons: target.reasons,
        matchedBy: target.matchedBy,
        author: event.author,
        tags: event.tags,
        previousValue: event.previousValue,
        currentValue: event.currentValue,
      },
      sortOrder: maxSort + 1,
      metadata: {
        provider: event.provider,
        flagKey: event.flagKey,
        flagName: event.flagName,
        action: event.action,
        environment: event.environment,
        severity: event.severity,
        fingerprint: event.fingerprint,
        correlatedService,
        correlationScore: target.score,
        matchedBy: target.matchedBy,
      },
    });

    await persistChangeEvent({
      investigationId: row.id,
      type: "feature_flag",
      service: correlatedService,
      author: event.author,
      occurredAt: event.occurredAt,
      metadata: {
        provider: event.provider,
        flagKey: event.flagKey,
        flagName: event.flagName,
        action: event.action,
        environment: event.environment,
        severity: event.severity,
        fingerprint: event.fingerprint,
        matchedBy: target.matchedBy,
        tags: event.tags,
      },
    });

    await db
      .update(investigationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(investigationsTable.id, row.id));

    attachedInvestigationIds.push(row.id);

    if (input.refreshPipeline && isSignozConfigured()) {
      await invalidatePipelineCache(row.id);
      await input.refreshPipeline(row.id);
      refreshedInvestigationIds.push(row.id);
    }
  }

  return {
    attachedInvestigationIds,
    skippedDuplicate,
    refreshedInvestigationIds,
    matchedBy: targets[0]?.matchedBy ?? "fallback_recent",
  };
}
