import { and, desc, eq, gte, sql } from "@repo/database";
import { db } from "@repo/database";
import {
  telemetryServiceErrorSummaryMvTable,
  telemetryTopFailingEndpointsMvTable,
} from "@repo/database/schema";

import type { InvestigationInsights } from "./investigation-insights";

function floorToHour(date: Date) {
  const copy = new Date(date);
  copy.setMinutes(0, 0, 0);
  return copy;
}

function normalizeOrganizationId(organizationId: string | null) {
  return organizationId ?? "00000000-0000-0000-0000-000000000000";
}

/** Feature #4 — Postgres-backed MV cache for SigNoz Cloud (no direct ClickHouse). */
export async function refreshPostgresMaterializedViewsFromInsights(input: {
  organizationId: string | null;
  serviceName: string;
  insights: InvestigationInsights;
}) {
  const organizationId = normalizeOrganizationId(input.organizationId);
  const windowStart = floorToHour(new Date());
  const summary = input.insights.latencySummary;

  if (summary) {
    await db
      .insert(telemetryServiceErrorSummaryMvTable)
      .values({
        organizationId,
        serviceName: input.serviceName,
        windowStart,
        requestCount: summary.requests,
        errorCount: summary.errors,
        p99Ms: summary.p99Ms,
        refreshedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          telemetryServiceErrorSummaryMvTable.organizationId,
          telemetryServiceErrorSummaryMvTable.serviceName,
          telemetryServiceErrorSummaryMvTable.windowStart,
        ],
        set: {
          requestCount: summary.requests,
          errorCount: summary.errors,
          p99Ms: summary.p99Ms,
          refreshedAt: new Date(),
        },
      });
  }

  for (const endpoint of input.insights.topFailingEndpoints) {
    await db
      .insert(telemetryTopFailingEndpointsMvTable)
      .values({
        organizationId,
        serviceName: input.serviceName,
        endpoint: endpoint.endpoint,
        windowStart,
        errorCount: endpoint.errorCount,
        p99Ms: endpoint.p99Ms,
        refreshedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          telemetryTopFailingEndpointsMvTable.organizationId,
          telemetryTopFailingEndpointsMvTable.serviceName,
          telemetryTopFailingEndpointsMvTable.endpoint,
          telemetryTopFailingEndpointsMvTable.windowStart,
        ],
        set: {
          errorCount: endpoint.errorCount,
          p99Ms: endpoint.p99Ms,
          refreshedAt: new Date(),
        },
      });
  }
}

export async function buildPostgresMaterializedInvestigationInsights(input: {
  serviceName: string;
  organizationId?: string | null;
  windowMinutes?: number;
  endpointLimit?: number;
}): Promise<InvestigationInsights | null> {
  const windowMinutes = input.windowMinutes ?? 15;
  const endpointLimit = input.endpointLimit ?? 5;
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const started = Date.now();

  const organizationKey = normalizeOrganizationId(input.organizationId ?? null);

  const summaryClauses = [
    eq(telemetryServiceErrorSummaryMvTable.serviceName, input.serviceName),
    gte(telemetryServiceErrorSummaryMvTable.windowStart, since),
    eq(telemetryServiceErrorSummaryMvTable.organizationId, organizationKey),
  ];

  const [summaryRow] = await db
    .select({
      requests: sql<number>`coalesce(sum(${telemetryServiceErrorSummaryMvTable.requestCount}), 0)`,
      errors: sql<number>`coalesce(sum(${telemetryServiceErrorSummaryMvTable.errorCount}), 0)`,
      p99Ms: sql<number | null>`max(${telemetryServiceErrorSummaryMvTable.p99Ms})`,
    })
    .from(telemetryServiceErrorSummaryMvTable)
    .where(and(...summaryClauses));

  const endpointClauses = [
    eq(telemetryTopFailingEndpointsMvTable.serviceName, input.serviceName),
    gte(telemetryTopFailingEndpointsMvTable.windowStart, since),
    eq(telemetryTopFailingEndpointsMvTable.organizationId, organizationKey),
  ];

  const endpointRows = await db
    .select({
      endpoint: telemetryTopFailingEndpointsMvTable.endpoint,
      errorCount: sql<number>`coalesce(sum(${telemetryTopFailingEndpointsMvTable.errorCount}), 0)`,
      p99Ms: sql<number | null>`max(${telemetryTopFailingEndpointsMvTable.p99Ms})`,
    })
    .from(telemetryTopFailingEndpointsMvTable)
    .where(and(...endpointClauses))
    .groupBy(telemetryTopFailingEndpointsMvTable.endpoint)
    .orderBy(desc(sql`coalesce(sum(${telemetryTopFailingEndpointsMvTable.errorCount}), 0)`))
    .limit(endpointLimit);

  const hasData =
    (summaryRow?.requests ?? 0) > 0 ||
    (summaryRow?.errors ?? 0) > 0 ||
    endpointRows.length > 0;

  if (!hasData) return null;

  return {
    enabled: true,
    serviceName: input.serviceName,
    windowMinutes,
    source: "postgres_materialized_view",
    materializedViewsAvailable: true,
    materializedViewBackend: "postgres",
    latencySummary: summaryRow
      ? {
          requests: Number(summaryRow.requests ?? 0),
          errors: Number(summaryRow.errors ?? 0),
          p99Ms: summaryRow.p99Ms != null ? Number(summaryRow.p99Ms) : null,
        }
      : null,
    topFailingEndpoints: endpointRows.map((row) => ({
      endpoint: row.endpoint,
      errorCount: Number(row.errorCount ?? 0),
      p99Ms: row.p99Ms != null ? Number(row.p99Ms) : null,
    })),
    queryElapsedMs: Date.now() - started,
  };
}

export async function getPostgresMaterializedViewStatus(organizationId?: string | null) {
  const organizationKey = normalizeOrganizationId(organizationId ?? null);
  const clauses = [eq(telemetryServiceErrorSummaryMvTable.organizationId, organizationKey)];

  const [summaryCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(telemetryServiceErrorSummaryMvTable)
    .where(and(...clauses));

  const [endpointCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(telemetryTopFailingEndpointsMvTable)
    .where(eq(telemetryTopFailingEndpointsMvTable.organizationId, organizationKey));

  return {
    enabled: true,
    backend: "postgres" as const,
    serviceSummaryRows: Number(summaryCount?.count ?? 0),
    endpointRows: Number(endpointCount?.count ?? 0),
    ready: Number(summaryCount?.count ?? 0) > 0 || Number(endpointCount?.count ?? 0) > 0,
  };
}
