import { and, eq } from "@repo/database";
import { db } from "@repo/database";
import {
  changeEventsTable,
  evidenceTable,
  investigationTimelineEntriesTable,
  runtimeSignalsTable,
  serviceDependenciesTable,
  servicesTable,
  type EvidenceType,
  type TimelineKind,
} from "@repo/database/schema";

import type { AlertClassification } from "../signoz/alert-classifier";
import type { SignozTraceRow } from "../signoz/types";
import type { InvestigationContext } from "./types";

function mapTimelineKindToEvidenceType(kind: TimelineKind): EvidenceType {
  const map: Record<TimelineKind, EvidenceType> = {
    ALERT: "alert",
    DEPLOY: "deployment",
    METRIC: "metric",
    LOG: "log",
    TRACE: "trace",
    CHANGE: "change",
    EBPF: "ebpf",
    AI: "metric",
  };
  return map[kind] ?? "change";
}

export async function clearDerivedInvestigationRows(investigationId: string) {
  await db.delete(evidenceTable).where(eq(evidenceTable.investigationId, investigationId));
  await db.delete(runtimeSignalsTable).where(eq(runtimeSignalsTable.investigationId, investigationId));
}

export async function persistTimelineEvidence(input: {
  investigationId: string;
  timelineEntryId: string;
  kind: TimelineKind;
  title: string;
  detail: string;
  occurredAt: Date;
  source?: string;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(evidenceTable).values({
    investigationId: input.investigationId,
    timelineEntryId: input.timelineEntryId,
    type: mapTimelineKindToEvidenceType(input.kind),
    description: `${input.title} — ${input.detail}`,
    occurredAt: input.occurredAt,
    metadata: {
      source: input.source,
      kind: input.kind,
      ...input.metadata,
    },
  });
}

export async function insertTimelineEntry(input: {
  investigationId: string;
  occurredAt: Date;
  kind: TimelineKind;
  title: string;
  detail: string;
  source?: string;
  sourceRef?: Record<string, unknown>;
  sortOrder: number;
  metadata?: Record<string, unknown>;
}) {
  const [entry] = await db
    .insert(investigationTimelineEntriesTable)
    .values({
      investigationId: input.investigationId,
      occurredAt: input.occurredAt,
      kind: input.kind,
      title: input.title,
      detail: input.detail,
      source: input.source,
      sourceRef: input.sourceRef,
      sortOrder: input.sortOrder,
    })
    .returning();

  if (entry) {
    await persistTimelineEvidence({
      investigationId: input.investigationId,
      timelineEntryId: entry.id,
      kind: input.kind,
      title: input.title,
      detail: input.detail,
      occurredAt: input.occurredAt,
      source: input.source,
      metadata: input.metadata,
    });
  }

  return entry;
}

export async function persistRuntimeSignalsFromTraces(input: {
  investigationId: string;
  service: string;
  traces: SignozTraceRow[];
  classification: AlertClassification;
}) {
  if (input.traces.length === 0) return;

  await db.delete(runtimeSignalsTable).where(eq(runtimeSignalsTable.investigationId, input.investigationId));

  const rows = input.traces.slice(0, 20).map((trace) => ({
    investigationId: input.investigationId,
    traceId: trace.traceId,
    service: trace.serviceName ?? input.service,
    metric:
      input.classification.kind === "latency_percentile"
        ? (input.classification.percentile ?? "latency")
        : "error_trace",
    latencyMs: trace.durationMs ?? null,
    p95Ms: input.classification.percentile === "p95" ? (trace.durationMs ?? null) : null,
    p99Ms: input.classification.percentile === "p99" ? (trace.durationMs ?? null) : null,
    errorRate: trace.hasError ? "1.0000" : "0.0000",
    signalTimestamp: trace.timestamp ? new Date(trace.timestamp) : new Date(),
    metadata: {
      spanName: trace.name,
      spanId: trace.spanId,
      source: "signoz",
    },
  }));

  await db.insert(runtimeSignalsTable).values(rows);
}

export async function persistChangeEvent(input: {
  investigationId: string;
  type: "deployment" | "commit" | "config" | "terraform" | "kubernetes";
  service?: string;
  author?: string;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}) {
  await db.insert(changeEventsTable).values({
    investigationId: input.investigationId,
    type: input.type,
    service: input.service,
    author: input.author,
    occurredAt: input.occurredAt,
    metadata: input.metadata,
  });
}

export function buildPersistedSummary(context: InvestigationContext) {
  return context.summary;
}

async function ensureService(name: string, healthy: boolean, latencyMs: number) {
  const [existing] = await db.select().from(servicesTable).where(eq(servicesTable.name, name)).limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(servicesTable)
    .values({ name, healthy, latencyMs, metadata: {} })
    .returning();
  return created;
}

/** Build service graph from real SigNoz dependency API — no hardcoded edges */
export async function buildServiceGraphFromSignoz(primaryService: string) {
  const { fetchSignozDependencies, fetchSignozServices } = await import("../signoz/service-map");

  const [services, edges] = await Promise.all([
    fetchSignozServices(),
    fetchSignozDependencies({ service: primaryService }),
  ]);

  if (services.length === 0 && edges.length === 0) return;

  const serviceMap = new Map<string, { healthy: boolean; latencyMs: number | null }>();
  for (const svc of services) {
    serviceMap.set(svc.name, { healthy: svc.healthy, latencyMs: svc.latencyMs });
  }

  const primaryMeta = serviceMap.get(primaryService) ?? { healthy: false, latencyMs: null };
  await ensureService(primaryService, primaryMeta.healthy, primaryMeta.latencyMs ?? 0);

  for (const edge of edges) {
    const srcMeta = serviceMap.get(edge.source) ?? { healthy: edge.healthy, latencyMs: edge.latencyMs };
    const dstMeta = serviceMap.get(edge.destination) ?? { healthy: edge.healthy, latencyMs: edge.latencyMs };

    const source = await ensureService(edge.source, srcMeta.healthy, srcMeta.latencyMs ?? 0);
    const dest = await ensureService(edge.destination, dstMeta.healthy, dstMeta.latencyMs ?? 0);
    if (!source || !dest) continue;

    const [existingEdge] = await db
      .select({ id: serviceDependenciesTable.id })
      .from(serviceDependenciesTable)
      .where(
        and(
          eq(serviceDependenciesTable.sourceServiceId, source.id),
          eq(serviceDependenciesTable.destinationServiceId, dest.id),
        ),
      )
      .limit(1);

    if (existingEdge) continue;

    await db.insert(serviceDependenciesTable).values({
      sourceServiceId: source.id,
      destinationServiceId: dest.id,
      healthy: edge.healthy,
      latencyMs: edge.latencyMs,
      metadata: { source: "signoz-dependency-graph" },
    });
  }
}
