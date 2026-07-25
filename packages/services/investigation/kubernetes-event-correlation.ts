import { eq } from "@repo/database";
import { db } from "@repo/database";
import {
  investigationTimelineEntriesTable,
  investigationsTable,
  type SelectInvestigation,
} from "@repo/database/schema";

import {
  parseKubernetesEvent,
  type KubernetesEventPayload,
} from "../kubernetes/webhook-parser";
import { isSignozConfigured } from "../signoz-env";
import { loadRecentInvestigationCandidates } from "./investigation-candidates";
import { insertTimelineEntry, persistChangeEvent } from "./persistence";
import { invalidatePipelineCache } from "./pipeline-cache";
import type { InvestigationContext } from "./types";

export type KubernetesEvent = ReturnType<typeof parseKubernetesEvent>;

export type KubernetesEventCorrelationResult = {
  attachedInvestigationIds: string[];
  skippedDuplicate: string[];
  refreshedInvestigationIds: string[];
  matchedBy: "time_window" | "service_match" | "critical_event" | "fallback_recent";
};

const DEFAULT_WINDOW_BEFORE_MS = 45 * 60 * 1000;
const DEFAULT_WINDOW_AFTER_MS = 20 * 60 * 1000;

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/[-_]+/g, "");
}

function serviceNameMatchesK8sResource(service: string, event: KubernetesEvent) {
  const serviceToken = normalizeToken(service);
  const eventToken = normalizeToken(event.service);
  const nameToken = normalizeToken(event.name);

  return (
    serviceToken === eventToken ||
    serviceToken.includes(eventToken) ||
    eventToken.includes(serviceToken) ||
    serviceToken.includes(nameToken) ||
    nameToken.includes(serviceToken)
  );
}

function investigationServices(row: SelectInvestigation) {
  return [row.primaryService, ...(row.affectedServices ?? [])].filter(
    (value): value is string => Boolean(value),
  );
}

function serviceMatchesInvestigation(row: SelectInvestigation, event: KubernetesEvent) {
  return investigationServices(row).some((service) => serviceNameMatchesK8sResource(service, event));
}

export function scoreKubernetesEventMatch(
  row: SelectInvestigation,
  event: KubernetesEvent,
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
    reasons.push("K8s event within incident window");
  }

  if (serviceMatchesInvestigation(row, event)) {
    score += 35;
    reasons.push(`Workload maps to ${event.service}`);
  }

  if (event.severity === "critical") {
    score += 20;
    reasons.push(`Critical cluster signal: ${event.reason}`);
  } else if (event.severity === "warning") {
    score += 10;
  }

  if (row.caseStatus !== "resolved") {
    score += 15;
    reasons.push("Open investigation");
  }

  return { score, inWindow, reasons };
}

export function selectKubernetesEventTargets(
  candidates: SelectInvestigation[],
  event: KubernetesEvent,
) {
  const scored = candidates
    .map((row) => ({ row, ...scoreKubernetesEventMatch(row, event) }))
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score);

  const inWindow = scored.filter((item) => item.inWindow);
  if (inWindow.length > 0) {
    return inWindow.map((item) => ({
      row: item.row,
      score: item.score,
      reasons: item.reasons,
      matchedBy: serviceMatchesInvestigation(item.row, event)
        ? ("service_match" as const)
        : event.severity === "critical"
          ? ("critical_event" as const)
          : ("time_window" as const),
    }));
  }

  const critical = scored.filter((item) => event.severity === "critical");
  if (critical.length > 0) {
    return critical.map((item) => ({
      row: item.row,
      score: item.score,
      reasons: item.reasons,
      matchedBy: "critical_event" as const,
    }));
  }

  const serviceMatches = scored.filter((item) => serviceMatchesInvestigation(item.row, event));
  if (serviceMatches.length > 0) {
    return serviceMatches.map((item) => ({
      row: item.row,
      score: item.score,
      reasons: item.reasons,
      matchedBy: "service_match" as const,
    }));
  }

  const recentOpen = candidates.find((row) => row.caseStatus !== "resolved");
  if (recentOpen) {
    const result = scoreKubernetesEventMatch(recentOpen, event);
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
    const result = scoreKubernetesEventMatch(candidates[0], event);
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

function k8sEventAlreadyAttached(
  timelineRows: Array<{ kind: string; sourceRef: unknown; metadata?: unknown }>,
  fingerprint: string,
) {
  return timelineRows.some((entry) => {
    if (entry.kind !== "CHANGE") return false;
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

/** Feature #50 — correlate K8s pod/deploy events into active investigations. */
export async function correlateKubernetesEvent(input: {
  payload: KubernetesEventPayload;
  organizationId?: string | null;
  ownerUserId?: string | null;
  refreshPipeline?: (investigationId: string) => Promise<void>;
}): Promise<KubernetesEventCorrelationResult> {
  const event = parseKubernetesEvent(input.payload);
  const candidates = await loadRecentInvestigationCandidates({
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
  });

  const targets = selectKubernetesEventTargets(candidates, event);
  const attachedInvestigationIds: string[] = [];
  const skippedDuplicate: string[] = [];
  const refreshedInvestigationIds: string[] = [];

  for (const target of targets) {
    const row = target.row;
    const timelineRows = await db
      .select()
      .from(investigationTimelineEntriesTable)
      .where(eq(investigationTimelineEntriesTable.investigationId, row.id));

    if (k8sEventAlreadyAttached(timelineRows, event.fingerprint)) {
      skippedDuplicate.push(row.id);
      continue;
    }

    const maxSort = timelineRows.reduce((max, entry) => Math.max(max, entry.sortOrder ?? 0), 0);
    const correlatedService =
      investigationServices(row).find((service) => serviceNameMatchesK8sResource(service, event)) ??
      event.service;

    await insertTimelineEntry({
      investigationId: row.id,
      occurredAt: event.occurredAt,
      kind: "CHANGE",
      title: event.title,
      detail: event.detail,
      source: "kubernetes-webhook",
      sourceRef: {
        kind: event.kind,
        name: event.name,
        namespace: event.namespace,
        reason: event.reason,
        severity: event.severity,
        fingerprint: event.fingerprint,
        correlationScore: target.score,
        matchReasons: target.reasons,
        matchedBy: target.matchedBy,
      },
      sortOrder: maxSort + 1,
      metadata: {
        kind: event.kind,
        name: event.name,
        namespace: event.namespace,
        reason: event.reason,
        revision: event.revision,
        severity: event.severity,
        fingerprint: event.fingerprint,
        correlatedService,
        correlationScore: target.score,
        matchedBy: target.matchedBy,
      },
    });

    await persistChangeEvent({
      investigationId: row.id,
      type: "kubernetes",
      service: correlatedService,
      occurredAt: event.occurredAt,
      metadata: {
        kind: event.kind,
        name: event.name,
        namespace: event.namespace,
        reason: event.reason,
        message: event.message,
        revision: event.revision,
        severity: event.severity,
        fingerprint: event.fingerprint,
        correlationScore: target.score,
        matchedBy: target.matchedBy,
      },
    });

    const context = (row.investigationContext as InvestigationContext | null) ?? {
      summary: row.title,
      evidence: [],
      affectedServices: row.affectedServices ?? [],
      incidentWindow: {
        start: row.incidentWindowStart?.toISOString() ?? new Date().toISOString(),
        end: row.incidentWindowEnd?.toISOString() ?? new Date().toISOString(),
      },
      signozConfigured: isSignozConfigured(),
      notes: [],
    };

    context.evidence.push({
      id: `k8s-${event.fingerprint}`,
      kind: "CHANGE",
      title: event.title,
      detail: event.detail,
      occurredAt: event.occurredAt.toISOString(),
      source: "kubernetes-webhook",
    });

    context.notes = [
      ...(context.notes ?? []),
      event.severity === "critical"
        ? `Critical K8s event correlated (${event.reason}) — inspect pod/workload health.`
        : "Kubernetes cluster event correlated into the investigation timeline.",
    ];

    await db
      .update(investigationsTable)
      .set({ investigationContext: context, updatedAt: new Date() })
      .where(eq(investigationsTable.id, row.id));

    await invalidatePipelineCache(row.id);
    attachedInvestigationIds.push(row.id);

    if (input.refreshPipeline) {
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
