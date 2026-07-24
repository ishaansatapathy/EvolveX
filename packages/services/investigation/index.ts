import { eq, asc, desc, and, or, isNull, gte } from "@repo/database";
import { db } from "@repo/database";
import {
  changeEventsTable,
  evidenceTable,
  investigationNotesTable,
  investigationSummariesTable,
  investigationTimelineEntriesTable,
  investigationsTable,
  runtimeSignalsTable,
  serviceDependenciesTable,
  servicesTable,
  type SelectInvestigation,
  type SelectTimelineEntry,
} from "@repo/database/schema";
import { logger } from "@repo/logger";

import { isSignozConfigured, getDefaultServiceName } from "../signoz-env";
import { signozClient } from "../signoz/client";
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
  logsToEvidence,
  needsEbpfEnrichment,
  signozAlertToMetricEvidence,
  tracesToEvidence,
} from "./correlation";
import { enrichEbpfFromSignozMetrics } from "../ebpf/signoz-metrics";
import { computeEvidenceCompleteness } from "./evidence-completeness";
import { buildEvidenceCitationCatalog } from "./evidence-citations";
import { buildStructuredEvidence, formatStructuredEvidenceForPrompt } from "./structured-evidence";
import { computeInvestigationPinpoint, loadPinpointFileSnippet } from "./pinpoint";
import { buildPostmortemFilename, buildPostmortemMarkdown } from "./postmortem-export";
import { suggestInvestigationFix } from "./fix-suggestion";
import { parseEbpfEvent, type EbpfEventPayload } from "../ebpf/webhook-parser";
import { parseGithubDeployEvent, type GithubPushPayload } from "../github/webhook-parser";
import { parseKubernetesEvent, type KubernetesEventPayload } from "../kubernetes/webhook-parser";
import { resolveInvestigationOwnerUserId } from "./owner";
import { generateAndPersistInvestigationSummary } from "./llm-summary";
import {
  buildPersistedSummary,
  buildServiceGraphFromSignoz,
  clearDerivedInvestigationRows,
  insertTimelineEntry,
  persistChangeEvent,
  persistRuntimeSignalsFromTraces,
} from "./persistence";
import type {
  ChangeEventRowDto,
  EvidenceRowDto,
  InvestigationContext,
  InvestigationDetail,
  InvestigationListItem,
  InvestigationOsContext,
  RuntimeSignalRowDto,
  TimelineEntryDto,
} from "./types";

function canAccessInvestigation(row: SelectInvestigation, userId: string) {
  return !row.userId || row.userId === userId;
}

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
    incidentId: row.incidentId,
    primaryService: row.primaryService,
    summary: row.summary,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
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
    source: row.source,
    sourceRef: (row.sourceRef as Record<string, unknown> | null) ?? null,
    sortOrder: row.sortOrder,
  };
}

function alertFromStoredPayload(row: SelectInvestigation): SignozAlert | undefined {
  const stored = row.signozAlertPayload as { alert?: SignozAlert } | null;
  return stored?.alert;
}

class InvestigationService {
  async list(userId: string, limit = 50): Promise<InvestigationListItem[]> {
    const rows = await db
      .select()
      .from(investigationsTable)
      .where(or(eq(investigationsTable.userId, userId), isNull(investigationsTable.userId)))
      .orderBy(desc(investigationsTable.createdAt))
      .limit(limit);
    return rows.map(toListItem);
  }

  async getById(id: string, userId: string): Promise<InvestigationDetail | null> {
    const [row] = await db
      .select()
      .from(investigationsTable)
      .where(eq(investigationsTable.id, id))
      .limit(1);
    if (!row || !canAccessInvestigation(row, userId)) return null;
    return toDetail(row);
  }

  async getTimeline(investigationId: string, userId: string): Promise<TimelineEntryDto[] | null> {
    const detail = await this.getById(investigationId, userId);
    if (!detail) return null;

    const rows = await db
      .select()
      .from(investigationTimelineEntriesTable)
      .where(eq(investigationTimelineEntriesTable.investigationId, investigationId))
      .orderBy(asc(investigationTimelineEntriesTable.sortOrder), asc(investigationTimelineEntriesTable.occurredAt));
    return rows.map(toTimelineEntry);
  }

  async getLogsForInvestigation(investigationId: string, userId: string) {
    const detail = await this.getById(investigationId, userId);
    if (!detail) return null;

    const startMs = detail.incidentWindowStart
      ? new Date(detail.incidentWindowStart).getTime()
      : Date.now() - 15 * 60 * 1000;
    const endMs = detail.incidentWindowEnd ? new Date(detail.incidentWindowEnd).getTime() : Date.now();
    const service = detail.affectedServices[0] ?? getDefaultServiceName();

    if (!isSignozConfigured()) return { logs: [], service };

    const logs = await signozClient.searchLogs({
      serviceName: service,
      startMs,
      endMs,
      limit: 50,
    });

    return { logs, service };
  }

  async getTracesForInvestigation(investigationId: string, userId: string) {
    const detail = await this.getById(investigationId, userId);
    if (!detail) return null;

    const startMs = detail.incidentWindowStart
      ? new Date(detail.incidentWindowStart).getTime()
      : Date.now() - 15 * 60 * 1000;
    const endMs = detail.incidentWindowEnd ? new Date(detail.incidentWindowEnd).getTime() : Date.now();
    const service = detail.affectedServices[0] ?? getDefaultServiceName();
    const isLatencyIncident = detail.context?.alertKind === "latency_percentile";

    if (!isSignozConfigured()) return { traces: [], service };

    const traces = isLatencyIncident
      ? await signozClient.searchSlowTraces({ serviceName: service, startMs, endMs, limit: 50 })
      : await signozClient.searchTracesInWindow({ serviceName: service, startMs, endMs, limit: 50 });

    return { traces, service };
  }

  async getOsContext(investigationId: string, userId: string): Promise<InvestigationOsContext | null> {
    const [row] = await db
      .select()
      .from(investigationsTable)
      .where(eq(investigationsTable.id, investigationId))
      .limit(1);

    if (!row || !canAccessInvestigation(row, userId)) return null;

    const [timeline, evidence, changeEvents, runtimeSignals, summaries] = await Promise.all([
      db
        .select()
        .from(investigationTimelineEntriesTable)
        .where(eq(investigationTimelineEntriesTable.investigationId, investigationId))
        .orderBy(
          asc(investigationTimelineEntriesTable.sortOrder),
          asc(investigationTimelineEntriesTable.occurredAt),
        ),
      db
        .select()
        .from(evidenceTable)
        .where(eq(evidenceTable.investigationId, investigationId))
        .orderBy(asc(evidenceTable.occurredAt)),
      db
        .select()
        .from(changeEventsTable)
        .where(eq(changeEventsTable.investigationId, investigationId))
        .orderBy(asc(changeEventsTable.occurredAt)),
      db
        .select()
        .from(runtimeSignalsTable)
        .where(eq(runtimeSignalsTable.investigationId, investigationId))
        .orderBy(asc(runtimeSignalsTable.signalTimestamp)),
      db
        .select()
        .from(investigationSummariesTable)
        .where(eq(investigationSummariesTable.investigationId, investigationId))
        .orderBy(desc(investigationSummariesTable.generatedAt))
        .limit(1),
    ]);

    const primaryService = row.primaryService ?? row.affectedServices[0] ?? null;
    const nodes: InvestigationOsContext["dependencies"]["nodes"] = [];
    const edges: InvestigationOsContext["dependencies"]["edges"] = [];

    if (primaryService) {
      const [rootService] = await db
        .select()
        .from(servicesTable)
        .where(eq(servicesTable.name, primaryService))
        .limit(1);

      if (rootService) {
        const outgoing = await db
          .select({
            edgeId: serviceDependenciesTable.id,
            edgeHealthy: serviceDependenciesTable.healthy,
            edgeLatencyMs: serviceDependenciesTable.latencyMs,
            destinationId: servicesTable.id,
            destinationName: servicesTable.name,
            destinationHealthy: servicesTable.healthy,
            destinationLatencyMs: servicesTable.latencyMs,
          })
          .from(serviceDependenciesTable)
          .innerJoin(servicesTable, eq(serviceDependenciesTable.destinationServiceId, servicesTable.id))
          .where(eq(serviceDependenciesTable.sourceServiceId, rootService.id));

        nodes.push({
          id: rootService.id,
          name: rootService.name,
          healthy: rootService.healthy,
          latencyMs: rootService.latencyMs,
        });

        for (const edge of outgoing) {
          if (!nodes.some((node) => node.id === edge.destinationId)) {
            nodes.push({
              id: edge.destinationId,
              name: edge.destinationName,
              healthy: edge.destinationHealthy,
              latencyMs: edge.destinationLatencyMs,
            });
          }

          edges.push({
            id: edge.edgeId,
            source: rootService.name,
            destination: edge.destinationName,
            healthy: edge.edgeHealthy,
            latencyMs: edge.edgeLatencyMs,
          });
        }
      }
    }

    const latestSummary = summaries[0];
    const mappedTimeline = timeline.map(toTimelineEntry);
    const mappedChangeEvents = changeEvents.map(
      (item): ChangeEventRowDto => ({
        id: item.id,
        type: item.type,
        service: item.service,
        author: item.author,
        occurredAt: item.occurredAt.toISOString(),
        metadata: item.metadata ?? {},
      }),
    );

    const evidenceCompleteness = computeEvidenceCompleteness({
      timeline: mappedTimeline,
      changeEvents: mappedChangeEvents,
      investigationContext: (row.investigationContext as InvestigationContext | null) ?? null,
      status: row.status,
    });

    const mappedRuntimeSignals = runtimeSignals.map(
      (item): RuntimeSignalRowDto => ({
        id: item.id,
        traceId: item.traceId,
        service: item.service,
        metric: item.metric,
        latencyMs: item.latencyMs,
        p95Ms: item.p95Ms,
        p99Ms: item.p99Ms,
        errorRate: item.errorRate,
        signalTimestamp: item.signalTimestamp.toISOString(),
        metadata: item.metadata ?? {},
      }),
    );

    const structuredEvidence = buildStructuredEvidence({
      timeline: mappedTimeline,
      changeEvents: mappedChangeEvents,
      runtimeSignals: mappedRuntimeSignals,
    });

    const mappedEvidence = evidence.map(
      (item): EvidenceRowDto => ({
        id: item.id,
        type: item.type,
        description: item.description,
        occurredAt: item.occurredAt.toISOString(),
        url: item.url,
        confidence: item.confidence,
        timelineEntryId: item.timelineEntryId,
        metadata: item.metadata ?? {},
      }),
    );

    const evidenceCitations = buildEvidenceCitationCatalog({
      timeline: mappedTimeline,
      evidence: mappedEvidence,
    });

    return {
      investigation: {
        id: row.id,
        incidentId: row.incidentId,
        status: row.status,
        severity: row.severity,
        primaryService: row.primaryService,
        summary: row.summary,
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
      },
      timeline: mappedTimeline,
      evidence: mappedEvidence,
      changeEvents: mappedChangeEvents,
      runtimeSignals: mappedRuntimeSignals,
      dependencies: { nodes, edges },
      llmSummary: latestSummary
        ? {
            markdown: latestSummary.markdown,
            generatedAt: latestSummary.generatedAt.toISOString(),
          }
        : null,
      evidenceCompleteness,
      structuredEvidence,
      evidenceCitations,
    };
  }

  async handleSignozWebhook(payload: SignozWebhookPayload): Promise<{ investigationIds: string[] }> {
    const investigationIds: string[] = [];
    const ownerUserId = await resolveInvestigationOwnerUserId();

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

      const primaryService = affectedServices[0] ?? getDefaultServiceName();

      const [created] = await db
        .insert(investigationsTable)
        .values({
          userId: ownerUserId,
          externalId: fingerprint,
          title,
          status: "building",
          severity: alert.labels.severity ?? payload.commonLabels?.severity ?? null,
          primaryService,
          startedAt: window.start,
          alertName: alert.labels.alertname ?? null,
          affectedServices,
          incidentWindowStart: window.start,
          incidentWindowEnd: window.end,
          signozAlertPayload: { payload, alert },
        })
        .returning();

      if (!created) continue;

      const incidentId = shortInvestigationId(created.id);
      await db
        .update(investigationsTable)
        .set({ incidentId })
        .where(eq(investigationsTable.id, created.id));

      await insertTimelineEntry({
        investigationId: created.id,
        occurredAt: window.start,
        kind: "ALERT",
        title: alert.labels.alertname ?? "Alert fired",
        detail:
          alert.annotations.summary ??
          alert.annotations.info ??
          `SigNoz alert ${alert.labels.alertname ?? "unknown"} started firing.`,
        source: "signoz-webhook",
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

      let traces: SignozTraceRow[] = [];
      let logs: Awaited<ReturnType<typeof signozClient.searchLogs>> = [];
      if (signozConfigured) {
        [traces, logs] = await Promise.all([
          isLatencyIncident
            ? signozClient.searchSlowTraces({
                serviceName: service,
                startMs,
                endMs,
                limit: 10,
              })
            : signozClient.searchErrorTraces({
                serviceName: service,
                startMs,
                endMs,
                limit: 10,
              }),
          signozClient.searchLogs({
            serviceName: service,
            startMs,
            endMs,
            limit: 15,
          }),
        ]);
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

      await db
        .delete(investigationTimelineEntriesTable)
        .where(
          and(
            eq(investigationTimelineEntriesTable.investigationId, investigationId),
            eq(investigationTimelineEntriesTable.kind, "LOG"),
          ),
        );

      await clearDerivedInvestigationRows(investigationId);

      let sortOrder = 1;
      const traceMode = isLatencyIncident ? "slow" : "error";
      const traceEvidence = tracesToEvidence(traces, traceMode);
      const logEvidence = logsToEvidence(logs);

      if (storedAlert) {
        const metricEvidence = signozAlertToMetricEvidence(
          storedAlert,
          classification,
          row.incidentWindowStart?.toISOString() ?? new Date().toISOString(),
        );
        if (metricEvidence) {
          await insertTimelineEntry({
            investigationId,
            occurredAt: new Date(metricEvidence.occurredAt),
            kind: "METRIC",
            title: metricEvidence.title,
            detail: metricEvidence.detail,
            source: "signoz-alert",
            sourceRef: { percentile: classification.percentile },
            sortOrder: sortOrder++,
            metadata: { percentile: classification.percentile },
          });
        }
      }

      for (const evidence of traceEvidence.slice(0, 10)) {
        await insertTimelineEntry({
          investigationId,
          occurredAt: new Date(evidence.occurredAt),
          kind: "TRACE",
          title: evidence.title,
          detail: evidence.detail,
          source: "signoz",
          sourceRef: { mode: traceMode },
          sortOrder: sortOrder++,
        });
      }

      for (const evidence of logEvidence.slice(0, 6)) {
        await insertTimelineEntry({
          investigationId,
          occurredAt: new Date(evidence.occurredAt),
          kind: "LOG",
          title: evidence.title,
          detail: evidence.detail,
          source: "signoz-logs",
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
          ...logEvidence,
        ],
        affectedServices: row.affectedServices,
        incidentWindow,
        signozConfigured,
        alertKind: classification.kind,
        latencyPercentile: classification.percentile,
        notes: [],
      };

      if (needsEbpfEnrichment(context)) {
        const ebpfEvidence = await enrichEbpfFromSignozMetrics({
          service,
          startMs,
          endMs,
        });

        if (ebpfEvidence.length > 0) {
          context.evidence.push(...ebpfEvidence);
          context.notes.push(
            "Kernel/network metrics loaded from SigNoz metrics pipeline (real eBPF-derived telemetry).",
          );

          for (const evidence of ebpfEvidence) {
            await insertTimelineEntry({
              investigationId,
              occurredAt: new Date(evidence.occurredAt),
              kind: "EBPF",
              title: evidence.title,
              detail: evidence.detail,
              source: evidence.source ?? "signoz-metrics",
              sortOrder: sortOrder++,
            });
          }
        }
      }

      await persistRuntimeSignalsFromTraces({
        investigationId,
        service,
        traces,
        classification,
      });
      await buildServiceGraphFromSignoz(service);

      const summaryText = buildPersistedSummary(context);

      const [timelineRows, changeRows, runtimeRows, evidenceRows] = await Promise.all([
        db
          .select()
          .from(investigationTimelineEntriesTable)
          .where(eq(investigationTimelineEntriesTable.investigationId, investigationId))
          .orderBy(asc(investigationTimelineEntriesTable.sortOrder)),
        db
          .select()
          .from(changeEventsTable)
          .where(eq(changeEventsTable.investigationId, investigationId)),
        db
          .select()
          .from(runtimeSignalsTable)
          .where(eq(runtimeSignalsTable.investigationId, investigationId)),
        db
          .select()
          .from(evidenceTable)
          .where(eq(evidenceTable.investigationId, investigationId))
          .orderBy(asc(evidenceTable.occurredAt)),
      ]);

      const mappedRuntimeRows: RuntimeSignalRowDto[] = runtimeRows.map((item) => ({
        id: item.id,
        traceId: item.traceId,
        service: item.service,
        metric: item.metric,
        latencyMs: item.latencyMs,
        p95Ms: item.p95Ms,
        p99Ms: item.p99Ms,
        errorRate: item.errorRate,
        signalTimestamp: item.signalTimestamp.toISOString(),
        metadata: item.metadata ?? {},
      }));

      const structuredForLlm = buildStructuredEvidence({
        timeline: timelineRows.map(toTimelineEntry),
        changeEvents: changeRows.map(
          (item): ChangeEventRowDto => ({
            id: item.id,
            type: item.type,
            service: item.service,
            author: item.author,
            occurredAt: item.occurredAt.toISOString(),
            metadata: item.metadata ?? {},
          }),
        ),
        runtimeSignals: mappedRuntimeRows,
      });

      await generateAndPersistInvestigationSummary({
        investigationId,
        title: row.title,
        summary: summaryText,
        affectedServices: row.affectedServices,
        timeline: timelineRows.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          title: entry.title,
          detail: entry.detail,
          occurredAt: entry.occurredAt.toISOString(),
          source: entry.source,
        })),
        evidence: evidenceRows.map((item) => ({
          type: item.type,
          description: item.description,
          occurredAt: item.occurredAt.toISOString(),
        })),
        changeEvents: changeRows.map((event) => ({
          type: event.type,
          service: event.service,
          author: event.author,
          occurredAt: event.occurredAt.toISOString(),
        })),
        runtimeSignalCount: runtimeRows.length,
        structuredEvidenceBlock: formatStructuredEvidenceForPrompt(structuredForLlm),
      }).then(async (llmResult) => {
        if (!llmResult) return;

        await insertTimelineEntry({
          investigationId,
          occurredAt: llmResult.generatedAt,
          kind: "AI",
          title: "AI root-cause summary generated",
          detail: "OpenAI analysis stored from collected timeline evidence (no fabricated signals).",
          source: "openai",
          sourceRef: { model: process.env.OPENAI_MODEL ?? "gpt-4o-mini" },
          sortOrder: sortOrder++,
        });
      });

      await db
        .update(investigationsTable)
        .set({
          status: "ready",
          summary: summaryText,
          primaryService: service,
          completedAt: new Date(),
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

  async handleGithubWebhook(payload: GithubPushPayload): Promise<{ attachedInvestigationIds: string[] }> {
    const deploy = parseGithubDeployEvent(payload);
    const ownerUserId = await resolveInvestigationOwnerUserId();
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000);

    const candidates = await db
      .select()
      .from(investigationsTable)
      .where(
        and(
          gte(investigationsTable.createdAt, since),
          ownerUserId
            ? or(eq(investigationsTable.userId, ownerUserId), isNull(investigationsTable.userId))
            : undefined,
        ),
      )
      .orderBy(desc(investigationsTable.createdAt));

    const attachedInvestigationIds: string[] = [];

    const attachDeploy = async (row: SelectInvestigation) => {
      const timelineRows = await db
        .select()
        .from(investigationTimelineEntriesTable)
        .where(eq(investigationTimelineEntriesTable.investigationId, row.id));

      const maxSort = timelineRows.reduce((max, entry) => Math.max(max, entry.sortOrder ?? 0), 0);

      await insertTimelineEntry({
        investigationId: row.id,
        occurredAt: deploy.occurredAt,
        kind: "DEPLOY",
        title: deploy.title,
        detail: deploy.detail,
        source: "github-webhook",
        sourceRef: {
          repo: deploy.repo,
          branch: deploy.branch,
          sha: deploy.sha,
          author: deploy.author,
        },
        sortOrder: maxSort + 1,
        metadata: { repo: deploy.repo, sha: deploy.sha, branch: deploy.branch },
      });

      await persistChangeEvent({
        investigationId: row.id,
        type: "commit",
        service: row.primaryService ?? row.affectedServices[0] ?? deploy.repo,
        author: deploy.author,
        occurredAt: deploy.occurredAt,
        metadata: {
          repo: deploy.repo,
          branch: deploy.branch,
          sha: deploy.sha,
          message: deploy.message,
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
        id: `deploy-${deploy.sha}`,
        kind: "DEPLOY",
        title: deploy.title,
        detail: deploy.detail,
        occurredAt: deploy.occurredAt.toISOString(),
        source: "github-webhook",
      });
      context.notes = [...(context.notes ?? []), "Deploy event correlated from GitHub push webhook."];

      await db
        .update(investigationsTable)
        .set({ investigationContext: context, updatedAt: new Date() })
        .where(eq(investigationsTable.id, row.id));

      attachedInvestigationIds.push(row.id);
    };

    for (const row of candidates) {
      const anchor = row.incidentWindowStart?.getTime() ?? row.createdAt.getTime();
      const deployMs = deploy.occurredAt.getTime();
      if (deployMs >= anchor - 45 * 60 * 1000 && deployMs <= anchor + 20 * 60 * 1000) {
        await attachDeploy(row);
      }
    }

    if (attachedInvestigationIds.length === 0 && candidates[0]) {
      await attachDeploy(candidates[0]);
    }

    return { attachedInvestigationIds };
  }

  private async findRecentInvestigationCandidates() {
    const ownerUserId = await resolveInvestigationOwnerUserId();
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000);

    return db
      .select()
      .from(investigationsTable)
      .where(
        and(
          gte(investigationsTable.createdAt, since),
          ownerUserId
            ? or(eq(investigationsTable.userId, ownerUserId), isNull(investigationsTable.userId))
            : undefined,
        ),
      )
      .orderBy(desc(investigationsTable.createdAt));
  }

  private async attachChangeToInvestigations(input: {
    occurredAt: Date;
    kind: "DEPLOY" | "CHANGE" | "EBPF";
    title: string;
    detail: string;
    source: string;
    sourceRef: Record<string, unknown>;
    changeType: "deployment" | "commit" | "config" | "terraform" | "kubernetes";
    service?: string;
    author?: string;
    changeMetadata: Record<string, unknown>;
    evidenceKind: InvestigationContext["evidence"][number]["kind"];
    windowBeforeMs?: number;
    windowAfterMs?: number;
  }): Promise<{ attachedInvestigationIds: string[] }> {
    const candidates = await this.findRecentInvestigationCandidates();
    const attachedInvestigationIds: string[] = [];
    const before = input.windowBeforeMs ?? 45 * 60 * 1000;
    const after = input.windowAfterMs ?? 20 * 60 * 1000;

    const attach = async (row: SelectInvestigation) => {
      const timelineRows = await db
        .select()
        .from(investigationTimelineEntriesTable)
        .where(eq(investigationTimelineEntriesTable.investigationId, row.id));

      const maxSort = timelineRows.reduce((max, entry) => Math.max(max, entry.sortOrder ?? 0), 0);

      await insertTimelineEntry({
        investigationId: row.id,
        occurredAt: input.occurredAt,
        kind: input.kind,
        title: input.title,
        detail: input.detail,
        source: input.source,
        sourceRef: input.sourceRef,
        sortOrder: maxSort + 1,
        metadata: input.changeMetadata,
      });

      await persistChangeEvent({
        investigationId: row.id,
        type: input.changeType,
        service: input.service ?? row.primaryService ?? row.affectedServices[0],
        author: input.author,
        occurredAt: input.occurredAt,
        metadata: input.changeMetadata,
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
        id: `${input.source}-${input.occurredAt.getTime()}`,
        kind: input.evidenceKind,
        title: input.title,
        detail: input.detail,
        occurredAt: input.occurredAt.toISOString(),
        source: input.source,
      });
      context.notes = [...(context.notes ?? []), `Event correlated from ${input.source}.`];

      await db
        .update(investigationsTable)
        .set({ investigationContext: context, updatedAt: new Date() })
        .where(eq(investigationsTable.id, row.id));

      attachedInvestigationIds.push(row.id);
    };

    for (const row of candidates) {
      const anchor = row.incidentWindowStart?.getTime() ?? row.createdAt.getTime();
      const eventMs = input.occurredAt.getTime();
      if (eventMs >= anchor - before && eventMs <= anchor + after) {
        await attach(row);
      }
    }

    if (attachedInvestigationIds.length === 0 && candidates[0]) {
      await attach(candidates[0]);
    }

    return { attachedInvestigationIds };
  }

  async handleKubernetesWebhook(
    payload: KubernetesEventPayload,
  ): Promise<{ attachedInvestigationIds: string[] }> {
    const event = parseKubernetesEvent(payload);

    return this.attachChangeToInvestigations({
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
      },
      changeType: "kubernetes",
      service: event.service,
      changeMetadata: {
        kind: event.kind,
        name: event.name,
        namespace: event.namespace,
        reason: event.reason,
        revision: event.revision,
      },
      evidenceKind: "CHANGE",
    });
  }

  async handleEbpfWebhook(payload: EbpfEventPayload): Promise<{ attachedInvestigationIds: string[] }> {
    const event = parseEbpfEvent(payload);

    return this.attachChangeToInvestigations({
      occurredAt: event.occurredAt,
      kind: "EBPF",
      title: event.title,
      detail: event.detail,
      source: "ebpf-webhook",
      sourceRef: event.metadata,
      changeType: "config",
      service: event.service,
      changeMetadata: event.metadata,
      evidenceKind: "EBPF",
      windowBeforeMs: 60 * 60 * 1000,
      windowAfterMs: 30 * 60 * 1000,
    });
  }

  async listNotes(investigationId: string, userId: string) {
    const [investigation] = await db
      .select()
      .from(investigationsTable)
      .where(eq(investigationsTable.id, investigationId))
      .limit(1);

    if (!investigation || !canAccessInvestigation(investigation, userId)) return null;

    const notes = await db
      .select()
      .from(investigationNotesTable)
      .where(eq(investigationNotesTable.investigationId, investigationId))
      .orderBy(asc(investigationNotesTable.createdAt));

    return notes.map((note) => ({
      id: note.id,
      body: note.body,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt?.toISOString() ?? null,
    }));
  }

  async createNote(investigationId: string, userId: string, body: string) {
    const trimmed = body.trim();
    if (!trimmed) {
      throw new Error("Note body is required");
    }

    const [investigation] = await db
      .select()
      .from(investigationsTable)
      .where(eq(investigationsTable.id, investigationId))
      .limit(1);

    if (!investigation || !canAccessInvestigation(investigation, userId)) return null;

    const [created] = await db
      .insert(investigationNotesTable)
      .values({
        investigationId,
        userId,
        body: trimmed,
      })
      .returning();

    if (!created) return null;

    return {
      id: created.id,
      body: created.body,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt?.toISOString() ?? null,
    };
  }

  async getPinpoint(investigationId: string, userId: string) {
    const [row] = await db
      .select()
      .from(investigationsTable)
      .where(eq(investigationsTable.id, investigationId))
      .limit(1);

    if (!row || !canAccessInvestigation(row, userId)) return null;

    const changeEvents = await db
      .select()
      .from(changeEventsTable)
      .where(eq(changeEventsTable.investigationId, investigationId))
      .orderBy(asc(changeEventsTable.occurredAt));

    const service = row.primaryService ?? row.affectedServices[0] ?? getDefaultServiceName();
    const startMs = row.incidentWindowStart?.getTime() ?? Date.now() - 15 * 60 * 1000;
    const endMs = row.incidentWindowEnd?.getTime() ?? Date.now();

    return computeInvestigationPinpoint({
      investigationId,
      service,
      startMs,
      endMs,
      changeEvents: changeEvents.map((event) => ({
        id: event.id,
        type: event.type,
        service: event.service,
        author: event.author,
        occurredAt: event.occurredAt.toISOString(),
        metadata: (event.metadata as Record<string, unknown>) ?? {},
      })),
    });
  }

  async suggestFix(investigationId: string, userId: string) {
    const [row] = await db
      .select()
      .from(investigationsTable)
      .where(eq(investigationsTable.id, investigationId))
      .limit(1);

    if (!row || !canAccessInvestigation(row, userId)) return null;

    const context = await this.getOsContext(investigationId, userId);
    if (!context) return null;

    const pinpoint = await this.getPinpoint(investigationId, userId);
    if (!pinpoint?.primary) return null;

    const primary = pinpoint.primary;
    let fileSnippet: string | null = null;

    if (primary.repo && primary.commitSha && primary.line > 0) {
      fileSnippet = await loadPinpointFileSnippet({
        repo: primary.repo,
        ref: primary.commitSha,
        file: primary.file,
        line: primary.line,
      });
    }

    const service = row.primaryService ?? row.affectedServices[0] ?? getDefaultServiceName();

    return suggestInvestigationFix({
      investigationTitle: row.title,
      service,
      pinpoint,
      timelineSummary: row.summary ?? context.investigation.summary ?? row.title,
      fileSnippet,
    });
  }

  async exportPostmortem(investigationId: string, userId: string) {
    const context = await this.getOsContext(investigationId, userId);
    if (!context) return null;

    const [row] = await db
      .select()
      .from(investigationsTable)
      .where(eq(investigationsTable.id, investigationId))
      .limit(1);

    if (!row || !canAccessInvestigation(row, userId)) return null;

    const notes = (await this.listNotes(investigationId, userId)) ?? [];
    const pinpoint =
      row.status === "ready" ? await this.getPinpoint(investigationId, userId) : null;
    const exportedAt = new Date().toISOString();
    const shortId = shortInvestigationId(row.id);

    const markdown = buildPostmortemMarkdown({
      shortId,
      title: row.title,
      affectedServices: row.affectedServices,
      createdAt: row.createdAt.toISOString(),
      context,
      notes,
      pinpoint,
      exportedAt,
    });

    return {
      markdown,
      filename: buildPostmortemFilename(shortId),
      exportedAt,
    };
  }

  async regenerateSummary(investigationId: string, userId: string) {
    const context = await this.getOsContext(investigationId, userId);
    if (!context) return null;

    const [row] = await db
      .select()
      .from(investigationsTable)
      .where(eq(investigationsTable.id, investigationId))
      .limit(1);

    if (!row) return null;

    return generateAndPersistInvestigationSummary({
      investigationId,
      title: row.title,
      summary: row.summary ?? context.investigation.summary ?? row.title,
      affectedServices: row.affectedServices,
      timeline: context.timeline.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        detail: entry.detail,
        occurredAt: entry.occurredAt,
        source: entry.source,
      })),
      evidence: context.evidence.map((item) => ({
        type: item.type,
        description: item.description,
        occurredAt: item.occurredAt,
      })),
      changeEvents: context.changeEvents.map((event) => ({
        type: event.type,
        service: event.service,
        author: event.author,
        occurredAt: event.occurredAt,
      })),
      runtimeSignalCount: context.runtimeSignals.length,
      structuredEvidenceBlock: formatStructuredEvidenceForPrompt(context.structuredEvidence),
    });
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
