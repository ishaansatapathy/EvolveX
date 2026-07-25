import type { ClickHouseQueryResult } from "./client";
import {
  executeClickHouseQuery,
  queryServiceLatencySummary,
  queryTopFailingEndpoints,
} from "./client";
import { buildSignozApiInvestigationInsights } from "./signoz-api-insights";
import {
  buildPostgresMaterializedInvestigationInsights,
  refreshPostgresMaterializedViewsFromInsights,
} from "./postgres-materialized-views";

export type ClickHouseEndpointRow = {
  endpoint: string;
  errorCount: number;
  p99Ms: number | null;
};

export type InvestigationInsightSource =
  | "materialized_view"
  | "postgres_materialized_view"
  | "native_query"
  | "signoz_api";

export type InvestigationInsights = {
  enabled: true;
  serviceName: string;
  windowMinutes: number;
  source: InvestigationInsightSource;
  materializedViewsAvailable: boolean;
  materializedViewBackend?: "clickhouse" | "postgres";
  latencySummary: {
    requests: number;
    errors: number;
    p99Ms: number | null;
  } | null;
  topFailingEndpoints: ClickHouseEndpointRow[];
  queryElapsedMs: number | null;
};

function rowNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseP99Ms(row: Record<string, unknown>) {
  const direct = rowNumber(row.p99_ms);
  if (direct != null) return direct;
  const nano = rowNumber(row.p99_duration_nano);
  return nano != null ? nano / 1_000_000 : null;
}

function parseLatencyRow(result: ClickHouseQueryResult | null) {
  const row = result?.rows[0];
  if (!row) return null;
  return {
    requests: rowNumber(row.request_count ?? row.requests) ?? 0,
    errors: rowNumber(row.error_count ?? row.errors) ?? 0,
    p99Ms: parseP99Ms(row),
  };
}

function parseEndpointRows(result: ClickHouseQueryResult | null): ClickHouseEndpointRow[] {
  if (!result) return [];
  return result.rows.map((row) => ({
    endpoint: String(row.endpoint ?? row.name ?? "unknown"),
    errorCount: rowNumber(row.error_count) ?? 0,
    p99Ms: rowNumber(row.p99_ms),
  }));
}

async function queryMaterializedServiceSummary(serviceName: string, windowMinutes: number) {
  return executeClickHouseQuery(
    `
SELECT
  service_name,
  sum(request_count) AS request_count,
  sum(error_count) AS error_count,
  quantile(0.99)(p99_duration_nano) / 1000000 AS p99_ms
FROM evolvex_service_error_summary_mv
WHERE service_name = {service:String}
  AND window_start >= now() - INTERVAL {window:UInt32} MINUTE
GROUP BY service_name
LIMIT 1
`.trim(),
    { service: serviceName, window: windowMinutes },
  );
}

async function queryMaterializedTopEndpoints(serviceName: string, windowMinutes: number, limit: number) {
  return executeClickHouseQuery(
    `
SELECT
  name AS endpoint,
  sum(error_count) AS error_count
FROM evolvex_top_failing_endpoints_mv
WHERE service_name = {service:String}
  AND window_start >= now() - INTERVAL {window:UInt32} MINUTE
GROUP BY endpoint
ORDER BY error_count DESC
LIMIT {limit:UInt32}
`.trim(),
    { service: serviceName, window: windowMinutes, limit },
  );
}

/** @deprecated Use InvestigationInsights */
export type ClickHouseInvestigationInsights = InvestigationInsights;

/** Feature #4 + #5 — CH MV → Postgres MV → native CH → SigNoz API fallback chain. */
export async function buildInvestigationInsights(input: {
  serviceName: string;
  organizationId?: string | null;
  windowMinutes?: number;
  endpointLimit?: number;
}): Promise<InvestigationInsights | null> {
  const clickhouse = await buildClickHouseInvestigationInsights(input);
  if (clickhouse) return clickhouse;

  const postgresMv = await buildPostgresMaterializedInvestigationInsights(input);
  if (postgresMv) return postgresMv;

  const live = await buildSignozApiInvestigationInsights(input);
  if (live) {
    void refreshPostgresMaterializedViewsFromInsights({
      organizationId: input.organizationId ?? null,
      serviceName: input.serviceName,
      insights: live,
    }).catch(() => undefined);
  }
  return live;
}

/** Feature #4 + #5 — ClickHouse MV-first, native query fallback (self-hosted SigNoz). */
export async function buildClickHouseInvestigationInsights(input: {
  serviceName: string;
  windowMinutes?: number;
  endpointLimit?: number;
}): Promise<InvestigationInsights | null> {
  const windowMinutes = input.windowMinutes ?? 15;
  const endpointLimit = input.endpointLimit ?? 5;
  const started = Date.now();

  const [mvLatency, mvEndpoints] = await Promise.all([
    queryMaterializedServiceSummary(input.serviceName, windowMinutes),
    queryMaterializedTopEndpoints(input.serviceName, windowMinutes, endpointLimit),
  ]);

  const mvHasData = Boolean(mvLatency?.rows.length || mvEndpoints?.rows.length);
  if (mvHasData) {
    return {
      enabled: true,
      serviceName: input.serviceName,
      windowMinutes,
      source: "materialized_view",
      materializedViewsAvailable: true,
      materializedViewBackend: "clickhouse",
      latencySummary: parseLatencyRow(mvLatency),
      topFailingEndpoints: parseEndpointRows(mvEndpoints),
      queryElapsedMs: Date.now() - started,
    };
  }

  const [nativeLatency, nativeEndpoints] = await Promise.all([
    queryServiceLatencySummary({ serviceName: input.serviceName, windowMinutes }),
    queryTopFailingEndpoints({
      serviceName: input.serviceName,
      windowMinutes,
      limit: endpointLimit,
    }),
  ]);

  if (!nativeLatency && !nativeEndpoints) return null;

  return {
    enabled: true,
    serviceName: input.serviceName,
    windowMinutes,
    source: "native_query",
    materializedViewsAvailable: false,
    latencySummary: parseLatencyRow(nativeLatency),
    topFailingEndpoints: parseEndpointRows(nativeEndpoints),
    queryElapsedMs: Date.now() - started,
  };
}

export function getMaterializedViewSql() {
  return `-- Feature #4 templates live in packages/services/telemetry-intelligence/clickhouse/materialized-views.sql`;
}
