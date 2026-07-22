import { asc, desc, eq, and } from "@repo/database";
import { db } from "@repo/database";
import {
  investigationTimelineEntriesTable,
  investigationsTable,
  type SelectInvestigation,
  type SelectTimelineEntry,
} from "@repo/database/schema";
import { logger } from "@repo/logger";

import { isSignozConfigured, getDefaultServiceName } from "../signoz-env";
import { signozClient } from "../signoz/client";
import { buildDemoErrorTraces, buildDemoSlowTraces, isDemoTracesEnabled } from "../signoz/demo-traces";
import type { SignozAlert, SignozTraceRow, SignozWebhookPayload } from "../signoz/types";
import {
  buildInvestigationTitle,
  extractServiceNames,
  incidentWindowFromAlert,
  isResolvedAlert,
  shortInvestigationId,
} from "../signoz/webhook-parser";
import {
  buildContextSummary,
  classifyInvestigationAlert,
  collectEbpfEvidence,
  needsEbpfEnrichment,
  signozAlertToMetricEvidence,
  tracesToEvidence,
} from "./correlation";
import type {
  InvestigationContext,
  InvestigationDetail,
  InvestigationListItem,
  TimelineEntryDto,
} from "./types";

function toListItem(row: SelectInvestigation): InvestigationListItem {
  return {
    id: row.id,
    shortId: shortInvestigationId(row.id),
    title: row.title,
    status: row.status,
    severity: row.severity,
    affectedServices: row.affectedServices ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

function toDetail(row: SelectInvestigation): InvestigationDetail {
  return {
    ...toListItem(row),
    alertName: row.alertName,
    incidentWindowStart: row.incidentWindowStart?.toISOString() ?? null,
    incidentWindowEnd: row.incidentWindowEnd?.toISOString() ?? null,
    context: (row.investigationContext as InvestigationContext | null) ?? null,
    errorMessage: row.errorMessage,
  };
}

function toTimelineEntry(row: SelectTimelineEntry): TimelineEntryDto {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    sourceRef: (row.sourceRef as Record<string, unknown> | null) ?? null,
  };
}

function alertFromStoredPayload(row: SelectInvestigation): SignozAlert | undefined {
  const stored = row.signozAlertPayload as { alert?: SignozAlert } | null;
  return stored?.alert;
}

class InvestigationService {
  async list(limit = 50): Promise<InvestigationListItem[]> {
    const rows = await db
      .select()
      .from(investigationsTable)
      .orderBy(desc(investigationsTable.createdAt))
      .limit(limit);
    return rows.map(toListItem);
  }

  async getById(id: string): Promise<InvestigationDetail | null> {
    const [row] = await db
      .select()
      .from(investigationsTable)
      .where(eq(investigationsTable.id, id))
      .limit(1);
    return row ? toDetail(row) : null;
  }

  async getTimeline(investigationId: string): Promise<TimelineEntryDto[]> {
    const rows = await db
      .select()
      .from(investigationTimelineEntriesTable)
      .where(eq(investigationTimelineEntriesTable.investigationId, investigationId))
      .orderBy(asc(investigationTimelineEntriesTable.sortOrder), asc(investigationTimelineEntriesTable.occurredAt));
    return rows.map(toTimelineEntry);
  }

  async handleSignozWebhook(payload: SignozWebhookPayload): Promise<{ investigationIds: string[] }> {
    const investigationIds: string[] = [];

    for (const alert of payload.alerts) {
      const fingerprint = alert.fingerprint ?? `${alert.labels.alertname ?? "alert"}-${alert.startsAt}`;
      const resolved = isResolvedAlert(payload, alert);

      const [existing] = await db
        .select()
        .from(investigationsTable)
        .where(eq(investigationsTable.externalId, fingerprint))
        .limit(1);

      if (resolved) {
        if (existing) {
          await db
            .update(investigationsTable)
            .set({ status: "ready", updatedAt: new Date() })
            .where(eq(investigationsTable.id, existing.id));
          investigationIds.push(existing.id);
        }
        continue;
      }

      if (existing) {
        investigationIds.push(existing.id);
        void this.runPipeline(existing.id);
        continue;
      }

      const window = incidentWindowFromAlert(alert);
      const affectedServices = extractServiceNames(alert, payload);
      const title = buildInvestigationTitle(alert);

      const [created] = await db
        .insert(investigationsTable)
        .values({
          externalId: fingerprint,
          title,
          status: "building",
          severity: alert.labels.severity ?? payload.commonLabels?.severity ?? null,
          alertName: alert.labels.alertname ?? null,
          affectedServices,
          incidentWindowStart: window.start,
          incidentWindowEnd: window.end,
          signozAlertPayload: { payload, alert },
        })
        .returning();

      if (!created) continue;

      await db.insert(investigationTimelineEntriesTable).values({
        investigationId: created.id,
        occurredAt: window.start,
        kind: "ALERT",
        title: alert.labels.alertname ?? "Alert fired",
        detail:
          alert.annotations.summary ??
          alert.annotations.info ??
          `SigNoz alert ${alert.labels.alertname ?? "unknown"} started firing.`,
        sourceRef: { fingerprint, labels: alert.labels, annotations: alert.annotations },
        sortOrder: 0,
      });

      investigationIds.push(created.id);
      void this.runPipeline(created.id);
    }

    return { investigationIds };
  }

  async runPipeline(investigationId: string): Promise<void> {
    try {
      const [row] = await db
        .select()
        .from(investigationsTable)
        .where(eq(investigationsTable.id, investigationId))
        .limit(1);

      if (!row) return;

      const signozConfigured = isSignozConfigured();
      const service = row.affectedServices[0] ?? getDefaultServiceName();
      const startMs = row.incidentWindowStart?.getTime() ?? Date.now() - 15 * 60 * 1000;
      const endMs = row.incidentWindowEnd?.getTime() ?? Date.now();
      const storedAlert = alertFromStoredPayload(row);
      const classification = classifyInvestigationAlert(storedAlert);
      const isLatencyIncident = classification.kind === "latency_percentile";
      let usedDemoFallback = false;

      let traces: SignozTraceRow[] = [];
      if (signozConfigured) {
        traces = isLatencyIncident
          ? await signozClient.searchSlowTraces({
              serviceName: service,
              startMs,
              endMs,
              limit: 10,
            })
          : await signozClient.searchErrorTraces({
              serviceName: service,
              startMs,
              endMs,
              limit: 10,
            });
      }

      if (traces.length === 0 && isDemoTracesEnabled()) {
        traces = isLatencyIncident
          ? buildDemoSlowTraces(service ?? "payments-svc")
          : buildDemoErrorTraces(service ?? "payments-svc");
        usedDemoFallback = true;
      }

      await db
        .delete(investigationTimelineEntriesTable)
        .where(
          and(
            eq(investigationTimelineEntriesTable.investigationId, investigationId),
            eq(investigationTimelineEntriesTable.kind, "TRACE"),
          ),
        );

      await db
        .delete(investigationTimelineEntriesTable)
        .where(
          and(
            eq(investigationTimelineEntriesTable.investigationId, investigationId),
            eq(investigationTimelineEntriesTable.kind, "METRIC"),
          ),
        );

      await db
        .delete(investigationTimelineEntriesTable)
        .where(
          and(
            eq(investigationTimelineEntriesTable.investigationId, investigationId),
            eq(investigationTimelineEntriesTable.kind, "EBPF"),
          ),
        );

      let sortOrder = 1;
      const traceMode = isLatencyIncident ? "slow" : "error";
      const traceEvidence = tracesToEvidence(traces, traceMode);

      if (storedAlert) {
        const metricEvidence = signozAlertToMetricEvidence(
          storedAlert,
          classification,
          row.incidentWindowStart?.toISOString() ?? new Date().toISOString(),
        );
        if (metricEvidence) {
          await db.insert(investigationTimelineEntriesTable).values({
            investigationId,
            occurredAt: new Date(metricEvidence.occurredAt),
            kind: "METRIC",
            title: metricEvidence.title,
            detail: metricEvidence.detail,
            sourceRef: { source: "signoz-alert", percentile: classification.percentile },
            sortOrder: sortOrder++,
          });
        }
      }

      for (const evidence of traceEvidence.slice(0, 10)) {
        await db.insert(investigationTimelineEntriesTable).values({
          investigationId,
          occurredAt: new Date(evidence.occurredAt),
          kind: "TRACE",
          title: evidence.title,
          detail: evidence.detail,
          sourceRef: { source: "signoz", mode: traceMode },
          sortOrder: sortOrder++,
        });
      }

      const alertName = row.alertName ?? "SigNoz alert";
      const incidentWindow = {
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
      };

      const metricFromAlert = storedAlert
        ? signozAlertToMetricEvidence(storedAlert, classification, incidentWindow.start)
        : null;

      const context: InvestigationContext = {
        summary: buildContextSummary({
          alertName,
          affectedServices: row.affectedServices,
          traceCount: traces.length,
          signozConfigured,
          classification,
        }),
        evidence: [
          {
            id: "alert-primary",
            kind: "ALERT",
            title: alertName,
            detail: row.title,
            occurredAt: row.incidentWindowStart?.toISOString() ?? new Date().toISOString(),
            source: "signoz-webhook",
          },
          ...(metricFromAlert ? [metricFromAlert] : []),
          ...traceEvidence,
        ],
        affectedServices: row.affectedServices,
        incidentWindow,
        signozConfigured,
        alertKind: classification.kind,
        latencyPercentile: classification.percentile,
        notes: usedDemoFallback
          ? [
              isLatencyIncident
                ? "Demo slow-trace evidence seeded locally. SigNoz computes p95/p99 — Evolvex only investigates the alert."
                : "Demo trace evidence seeded locally (development only — use pnpm signoz:loadgen in production).",
            ]
          : [],
      };

      if (needsEbpfEnrichment(context)) {
        const ebpfEvidence = collectEbpfEvidence(context);
        context.evidence.push(...ebpfEvidence);
        context.notes.push(
          "Kernel/runtime enrichment attached for tail-latency investigation (connection pool / TCP / syscall context).",
        );

        for (const evidence of ebpfEvidence) {
          await db.insert(investigationTimelineEntriesTable).values({
            investigationId,
            occurredAt: new Date(evidence.occurredAt),
            kind: "EBPF",
            title: evidence.title,
            detail: evidence.detail,
            sourceRef: { source: "ebpf-enricher" },
            sortOrder: sortOrder++,
          });
        }
      }

      await db
        .update(investigationsTable)
        .set({
          status: "ready",
          investigationContext: context,
          updatedAt: new Date(),
          errorMessage: null,
        })
        .where(eq(investigationsTable.id, investigationId));
    } catch (err) {
      logger.error("Investigation pipeline failed", {
        investigationId,
        message: err instanceof Error ? err.message : String(err),
      });
      await db
        .update(investigationsTable)
        .set({
          status: "failed",
          errorMessage: err instanceof Error ? err.message : "Investigation pipeline failed",
          updatedAt: new Date(),
        })
        .where(eq(investigationsTable.id, investigationId));
    }
  }

  async rerunAllPipelines(): Promise<number> {
    const rows = await db.select({ id: investigationsTable.id }).from(investigationsTable);
    for (const row of rows) {
      await this.runPipeline(row.id);
    }
    return rows.length;
  }
}

export default InvestigationService;
