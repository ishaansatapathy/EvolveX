import { getTelemetryIntelligenceConfig } from "./config";
import { applyClickHouseMaterializedViews } from "./clickhouse/apply-materialized-views";
import { getPostgresMaterializedViewStatus } from "./clickhouse/postgres-materialized-views";

export { getTelemetryIntelligenceConfig } from "./config";
export {
  TelemetryIntelligenceOrchestrator,
  createTelemetryIntelligenceOrchestrator,
  getDefaultTelemetryIntelligenceOrchestrator,
} from "./orchestrator";
export { computeAdaptiveTailSampling } from "./sampling/adaptive-tail";
export { computeChangeAwareSampling } from "./sampling/change-aware";
export { computeContextAwareSampling, mergeSamplingPolicies } from "./sampling/context-aware";
export { listActiveSamplingPolicies, cleanupExpiredSamplingPolicies } from "./sampling/policy-store";
export { mapSamplingPolicyRows } from "./sampling/policy-mapper";
export { generateCollectorConfig } from "./collector/config-generator";
export { buildCollectorConfigForOrganization } from "./collector/org-config";
export { verifyCollectorApiKey, isCollectorAuthConfigured } from "./collector/auth";
export { buildAlertEnrichment } from "./enrichment/similar-alerts";
export { buildServiceMapDeepCorrelation } from "./service-map/deep-correlation";
export { buildTelemetryIntelligenceDashboard } from "./dashboard-metrics";
export { ensureTelemetryIntelligenceForInvestigation } from "./investigation-snapshot";
export { queryServiceLatencySummary, queryTopFailingEndpoints, executeClickHouseQuery } from "./clickhouse/client";
export {
  applyClickHouseMaterializedViews,
  getClickHouseMaterializedViewStatus,
} from "./clickhouse/apply-materialized-views";
export {
  buildPostgresMaterializedInvestigationInsights,
  getPostgresMaterializedViewStatus,
  refreshPostgresMaterializedViewsFromInsights,
} from "./clickhouse/postgres-materialized-views";
export {
  buildInvestigationInsights,
  buildClickHouseInvestigationInsights,
  type InvestigationInsights,
  type ClickHouseInvestigationInsights,
} from "./clickhouse/investigation-insights";
export { buildSignozApiInvestigationInsights } from "./clickhouse/signoz-api-insights";

/** Feature #4 — apply ClickHouse MVs when configured; Postgres MV cache for SigNoz Cloud. */
export async function ensureTelemetryMaterializedViews(input?: { organizationId?: string | null }) {
  const clickhouse = getTelemetryIntelligenceConfig().clickhouseEnabled
    ? await applyClickHouseMaterializedViews()
    : null;
  const postgres = await getPostgresMaterializedViewStatus(input?.organizationId ?? null);

  return {
    clickhouse,
    postgres,
    ready: Boolean(clickhouse?.ok || postgres.ready),
  };
}

export type {
  AlertEnrichmentSnapshot,
  SamplingPolicyDecision,
  TelemetryIntelligenceSnapshot,
  TelemetrySamplingMode,
} from "./types";
