import { eq } from "@repo/database";
import { db } from "@repo/database";
import {
  investigationTimelineEntriesTable,
  investigationsTable,
  type SelectInvestigation,
} from "@repo/database/schema";

import { parseEbpfEvent, type EbpfEventPayload } from "../ebpf/webhook-parser";
import { isSignozConfigured } from "../signoz-env";
import { loadRecentInvestigationCandidates } from "./investigation-candidates";
import { insertTimelineEntry } from "./persistence";
import { invalidatePipelineCache } from "./pipeline-cache";
import type { InvestigationContext } from "./types";

export type EbpfEvent = ReturnType<typeof parseEbpfEvent>;

export type EbpfEventCorrelationResult = {
  attachedInvestigationIds: string[];
  skippedDuplicate: string[];
  refreshedInvestigationIds: string[];
  matchedBy: "time_window" | "service_match" | "latency_incident" | "critical_signal" | "fallback_recent";
};

const DEFAULT_WINDOW_BEFORE_MS = 60 * 60 * 1000;
const DEFAULT_WINDOW_AFTER_MS = 30 * 60 * 1000;

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/[-_]+/g, "");
}

function serviceNameMatchesEbpfResource(service: string, event: EbpfEvent) {
  const serviceToken = normalizeToken(service);
  const eventToken = normalizeToken(event.service);
  return serviceToken === eventToken || serviceToken.includes(eventToken) || eventToken.includes(serviceToken);
}

function investigationServices(row: SelectInvestigation) {
  return [row.primaryService, ...(row.affectedServices ?? [])].filter(
    (value): value is string => Boolean(value),
  );
}

function isLatencyInvestigation(row: SelectInvestigation, context: InvestigationContext | null) {
  return context?.alertKind === "latency_percentile";
}

export function scoreEbpfEventMatch(
  row: SelectInvestigation,
  event: EbpfEvent,
  windowBeforeMs = DEFAULT_WINDOW_BEFORE_MS,
  windowAfterMs = DEFAULT_WINDOW_AFTER_MS,
) {
  let score = 0;
  const reasons: string[] = [];
  const context = (row.investigationContext as InvestigationContext | null) ?? null;

  const anchor = row.incidentWindowStart?.getTime() ?? row.createdAt.getTime();
  const eventMs = event.occurredAt.getTime();
  const inWindow = eventMs >= anchor - windowBeforeMs && eventMs <= anchor + windowAfterMs;

  if (inWindow) {
    score += 45;
    reasons.push("eBPF signal within incident window");
  }

  if (serviceNameMatchesEbpfResource(row.primaryService ?? "", event) ||
    investigationServices(row).some((service) => serviceNameMatchesEbpfResource(service, event))) {
    score += 35;
    reasons.push(`Kernel signal maps to ${event.service}`);
  }

  if (isLatencyInvestigation(row, context)) {
    score += 25;
    reasons.push("Latency percentile investigation — eBPF highly relevant");
  }

  if (event.severity === "critical") {
    score += 20;
    reasons.push(`Critical kernel/network signal (${event.type})`);
  } else if (event.collector === "obi") {
    score += 15;
    reasons.push("OpenTelemetry eBPF Instrumentation (OBI)");
  }

  if (row.caseStatus !== "resolved") {
    score += 10;
    reasons.push("Open investigation");
  }

  return { score, inWindow, reasons };
}

export function selectEbpfEventTargets(candidates: SelectInvestigation[], event: EbpfEvent) {
  const scored = candidates
    .map((row) => ({ row, ...scoreEbpfEventMatch(row, event) }))
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score);

  const latencyMatches = scored.filter((item) =>
    isLatencyInvestigation(item.row, item.row.investigationContext as InvestigationContext | null),
  );
  if (latencyMatches.length > 0) {
    return latencyMatches.map((item) => ({
      row: item.row,
      score: item.score,
      reasons: item.reasons,
      matchedBy: investigationServices(item.row).some((service) =>
        serviceNameMatchesEbpfResource(service, event),
      )
        ? ("service_match" as const)
        : ("latency_incident" as const),
    }));
  }

  const inWindow = scored.filter((item) => item.inWindow);
  if (inWindow.length > 0) {
    return inWindow.map((item) => ({
      row: item.row,
      score: item.score,
      reasons: item.reasons,
      matchedBy: event.severity === "critical" ? ("critical_signal" as const) : ("time_window" as const),
    }));
  }

  const critical = scored.filter((item) => event.severity === "critical" || event.collector === "obi");
  if (critical.length > 0) {
    return critical.map((item) => ({
      row: item.row,
      score: item.score,
      reasons: item.reasons,
      matchedBy: "critical_signal" as const,
    }));
  }

  const recentOpen = candidates.find((row) => row.caseStatus !== "resolved");
  if (recentOpen) {
    const result = scoreEbpfEventMatch(recentOpen, event);
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
    const result = scoreEbpfEventMatch(candidates[0], event);
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

function ebpfEventAlreadyAttached(
  timelineRows: Array<{ kind: string; sourceRef: unknown; metadata: unknown }>,
  fingerprint: string,
) {
  return timelineRows.some((entry) => {
    if (entry.kind !== "EBPF") return false;
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

/** Feature #51 — correlate OBI/eBPF kernel signals into active investigations. */
export async function correlateEbpfEvent(input: {
  payload: EbpfEventPayload;
  organizationId?: string | null;
  ownerUserId?: string | null;
  refreshPipeline?: (investigationId: string) => Promise<void>;
}): Promise<EbpfEventCorrelationResult> {
  const event = parseEbpfEvent(input.payload);
  const candidates = await loadRecentInvestigationCandidates({
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
  });

  const targets = selectEbpfEventTargets(candidates, event);
  const attachedInvestigationIds: string[] = [];
  const skippedDuplicate: string[] = [];
  const refreshedInvestigationIds: string[] = [];

  for (const target of targets) {
    const row = target.row;
    const timelineRows = await db
      .select()
      .from(investigationTimelineEntriesTable)
      .where(eq(investigationTimelineEntriesTable.investigationId, row.id));

    if (ebpfEventAlreadyAttached(timelineRows, event.fingerprint)) {
      skippedDuplicate.push(row.id);
      continue;
    }

    const maxSort = timelineRows.reduce((max, entry) => Math.max(max, entry.sortOrder ?? 0), 0);
    const correlatedService =
      investigationServices(row).find((service) => serviceNameMatchesEbpfResource(service, event)) ??
      event.service;

    await insertTimelineEntry({
      investigationId: row.id,
      occurredAt: event.occurredAt,
      kind: "EBPF",
      title: event.title,
      detail: event.detail,
      source: event.collector === "obi" ? "obi-webhook" : "ebpf-webhook",
      sourceRef: {
        type: event.type,
        signalLayer: event.signalLayer,
        severity: event.severity,
        collector: event.collector,
        fingerprint: event.fingerprint,
        correlationScore: target.score,
        matchReasons: target.reasons,
        matchedBy: target.matchedBy,
        ...event.metadata,
      },
      sortOrder: maxSort + 1,
      metadata: {
        type: event.type,
        signalLayer: event.signalLayer,
        severity: event.severity,
        collector: event.collector,
        correlatedService,
        fingerprint: event.fingerprint,
        correlationScore: target.score,
        matchedBy: target.matchedBy,
        ...event.metadata,
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
      id: `ebpf-${event.fingerprint}`,
      kind: "EBPF",
      title: event.title,
      detail: event.detail,
      occurredAt: event.occurredAt.toISOString(),
      source: event.collector === "obi" ? "obi-webhook" : "ebpf-webhook",
    });

    context.notes = [
      ...(context.notes ?? []),
      event.collector === "obi"
        ? `OBI kernel/network signal correlated (${event.signalLayer}) — inspect socket/connect path.`
        : `eBPF ${event.signalLayer} signal correlated from collector webhook.`,
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
