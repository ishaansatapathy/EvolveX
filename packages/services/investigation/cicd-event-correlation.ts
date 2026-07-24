import { eq } from "@repo/database";
import { db } from "@repo/database";
import {
  investigationTimelineEntriesTable,
  investigationsTable,
  type SelectInvestigation,
} from "@repo/database/schema";

import { parseCicdEvent, type CicdEventPayload } from "../cicd/webhook-parser";
import { inferServiceNameFromRepo } from "../github/webhook-parser";
import { isSignozConfigured } from "../signoz-env";
import { loadRecentInvestigationCandidates } from "./investigation-candidates";
import { insertTimelineEntry, persistChangeEvent } from "./persistence";
import { invalidatePipelineCache } from "./pipeline-cache";
import type { InvestigationContext } from "./types";

export type CicdEvent = ReturnType<typeof parseCicdEvent>;

export type CicdEventCorrelationResult = {
  attachedInvestigationIds: string[];
  skippedDuplicate: string[];
  refreshedInvestigationIds: string[];
  matchedBy: "time_window" | "service_match" | "pipeline_failure" | "deploy_stage" | "fallback_recent";
};

const DEFAULT_WINDOW_BEFORE_MS = 90 * 60 * 1000;
const DEFAULT_WINDOW_AFTER_MS = 30 * 60 * 1000;

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/[-_]+/g, "");
}

function serviceNameMatchesCicd(service: string, event: CicdEvent) {
  const serviceToken = normalizeToken(service);
  const eventToken = normalizeToken(event.service);
  const inferred = inferServiceNameFromRepo(event.repository);
  const inferredToken = inferred ? normalizeToken(inferred) : "";
  const repoToken = normalizeToken(event.repository.split("/").pop() ?? event.repository);

  return (
    serviceToken === eventToken ||
    serviceToken.includes(eventToken) ||
    eventToken.includes(serviceToken) ||
    (inferredToken &&
      (serviceToken === inferredToken ||
        serviceToken.includes(inferredToken) ||
        inferredToken.includes(serviceToken))) ||
    serviceToken.includes(repoToken) ||
    repoToken.includes(serviceToken)
  );
}

function investigationServices(row: SelectInvestigation) {
  return [row.primaryService, ...(row.affectedServices ?? [])].filter(
    (value): value is string => Boolean(value),
  );
}

function serviceMatchesInvestigation(row: SelectInvestigation, event: CicdEvent) {
  return investigationServices(row).some((service) => serviceNameMatchesCicd(service, event));
}

export function scoreCicdEventMatch(
  row: SelectInvestigation,
  event: CicdEvent,
  windowBeforeMs = DEFAULT_WINDOW_BEFORE_MS,
  windowAfterMs = DEFAULT_WINDOW_AFTER_MS,
) {
  let score = 0;
  const reasons: string[] = [];

  const anchor = row.incidentWindowStart?.getTime() ?? row.createdAt.getTime();
  const eventMs = event.occurredAt.getTime();
  const inWindow = eventMs >= anchor - windowBeforeMs && eventMs <= anchor + windowAfterMs;

  if (inWindow) {
    score += 45;
    reasons.push("CI/CD event within incident window");
  }

  if (serviceMatchesInvestigation(row, event)) {
    score += 35;
    reasons.push(`Pipeline maps to ${event.service}`);
  }

  if (event.status === "failure") {
    score += 30;
    reasons.push(`${event.stage} failed — delivery risk before alert`);
  } else if (event.status === "retried") {
    score += 20;
    reasons.push("Pipeline retried — flaky build/test signal");
  }

  if (event.stage === "deploy" || event.stage === "release") {
    score += 25;
    reasons.push(`${event.stage} stage correlated with incident timeline`);
  }

  if (event.severity === "critical") {
    score += 15;
    reasons.push("Critical pipeline stage failure");
  }

  if (row.caseStatus !== "resolved") {
    score += 10;
    reasons.push("Open investigation");
  }

  return { score, inWindow, reasons };
}

export function selectCicdEventTargets(candidates: SelectInvestigation[], event: CicdEvent) {
  const scored = candidates
    .map((row) => ({ row, ...scoreCicdEventMatch(row, event) }))
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score);

  const failureMatches = scored.filter(
    (item) =>
      (event.status === "failure" || event.status === "retried") &&
      (item.inWindow || serviceMatchesInvestigation(item.row, event)),
  );
  if (failureMatches.length > 0) {
    return failureMatches.map((item) => ({
      row: item.row,
      score: item.score,
      reasons: item.reasons,
      matchedBy:
        event.stage === "deploy" || event.stage === "release"
          ? ("deploy_stage" as const)
          : event.status === "failure"
            ? ("pipeline_failure" as const)
            : serviceMatchesInvestigation(item.row, event)
              ? ("service_match" as const)
              : ("time_window" as const),
    }));
  }

  const deployMatches = scored.filter(
    (item) =>
      (event.stage === "deploy" || event.stage === "release") &&
      (item.inWindow || serviceMatchesInvestigation(item.row, event)),
  );
  if (deployMatches.length > 0) {
    return deployMatches.map((item) => ({
      row: item.row,
      score: item.score,
      reasons: item.reasons,
      matchedBy: "deploy_stage" as const,
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
    const result = scoreCicdEventMatch(recentOpen, event);
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
    const result = scoreCicdEventMatch(candidates[0], event);
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

function cicdEventAlreadyAttached(
  timelineRows: Array<{ kind: string; source?: string | null; sourceRef: unknown; metadata: unknown }>,
  fingerprint: string,
) {
  return timelineRows.some((entry) => {
    const source = entry.source ?? "";
    if (!source.includes("cicd")) return false;
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

/** Feature #53 — correlate CI/CD pipeline stages into active investigations. */
export async function correlateCicdEvent(input: {
  payload: CicdEventPayload;
  organizationId?: string | null;
  ownerUserId?: string | null;
  refreshPipeline?: (investigationId: string) => Promise<void>;
}): Promise<CicdEventCorrelationResult> {
  const event = parseCicdEvent(input.payload);
  const candidates = await loadRecentInvestigationCandidates({
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
  });

  const targets = selectCicdEventTargets(candidates, event);
  const attachedInvestigationIds: string[] = [];
  const skippedDuplicate: string[] = [];
  const refreshedInvestigationIds: string[] = [];

  for (const target of targets) {
    const row = target.row;
    const timelineRows = await db
      .select()
      .from(investigationTimelineEntriesTable)
      .where(eq(investigationTimelineEntriesTable.investigationId, row.id));

    if (cicdEventAlreadyAttached(timelineRows, event.fingerprint)) {
      skippedDuplicate.push(row.id);
      continue;
    }

    const maxSort = timelineRows.reduce((max, entry) => Math.max(max, entry.sortOrder ?? 0), 0);
    const correlatedService =
      investigationServices(row).find((service) => serviceNameMatchesCicd(service, event)) ??
      event.service;

    await insertTimelineEntry({
      investigationId: row.id,
      occurredAt: event.occurredAt,
      kind: event.timelineKind,
      title: event.title,
      detail: event.detail,
      source: "cicd-webhook",
      sourceRef: {
        provider: event.provider,
        stage: event.stage,
        status: event.status,
        jobName: event.jobName,
        repository: event.repository,
        branch: event.branch,
        commitSha: event.commitSha,
        runUrl: event.runUrl,
        runId: event.runId,
        attempt: event.attempt,
        severity: event.severity,
        fingerprint: event.fingerprint,
        correlationScore: target.score,
        matchReasons: target.reasons,
        matchedBy: target.matchedBy,
      },
      sortOrder: maxSort + 1,
      metadata: {
        provider: event.provider,
        stage: event.stage,
        status: event.status,
        jobName: event.jobName,
        repository: event.repository,
        branch: event.branch,
        commitSha: event.commitSha,
        runUrl: event.runUrl,
        severity: event.severity,
        fingerprint: event.fingerprint,
        correlatedService,
        correlationScore: target.score,
        matchedBy: target.matchedBy,
      },
    });

    await persistChangeEvent({
      investigationId: row.id,
      type: "cicd",
      service: correlatedService,
      author: event.author,
      occurredAt: event.occurredAt,
      metadata: {
        provider: event.provider,
        stage: event.stage,
        status: event.status,
        jobName: event.jobName,
        repository: event.repository,
        branch: event.branch,
        commitSha: event.commitSha,
        runUrl: event.runUrl,
        fingerprint: event.fingerprint,
        matchedBy: target.matchedBy,
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
