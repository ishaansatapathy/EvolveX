import type { AlertClassification } from "../signoz/alert-classifier";
import type { SignozAlert, SignozWebhookPayload } from "../signoz/types";

export type TelemetrySamplingMode = "normal" | "elevated" | "incident" | "change_boost" | "cooldown";

export type SamplingPolicyDecision = {
  serviceName: string;
  mode: TelemetrySamplingMode;
  sampleRate: number;
  reason: string;
  triggerSource: string;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
};

export type SimilarAlertMatch = {
  investigationId: string;
  shortId: string;
  title: string;
  alertName: string | null;
  primaryService: string | null;
  createdAt: string;
  matchReason: string;
};

export type AlertEnrichmentSnapshot = {
  alertName: string;
  serviceNames: string[];
  classification: AlertClassification;
  severity: string | null;
  similarAlerts: SimilarAlertMatch[];
  recentDeployCount: number;
  baselineHealthy: boolean | null;
  enrichmentNotes: string[];
};

export type ServiceMapCorrelationSnapshot = {
  primaryService: string;
  upstream: string[];
  downstream: string[];
  affectedServices: string[];
  propagationPaths: string[][];
};

export type InvestigationRuntimeInsights = {
  enabled: true;
  serviceName: string;
  windowMinutes: number;
  source: "materialized_view" | "postgres_materialized_view" | "native_query" | "signoz_api";
  materializedViewsAvailable: boolean;
  materializedViewBackend?: "clickhouse" | "postgres";
  latencySummary: {
    requests: number;
    errors: number;
    p99Ms: number | null;
  } | null;
  topFailingEndpoints: Array<{
    endpoint: string;
    errorCount: number;
    p99Ms: number | null;
  }>;
  queryElapsedMs: number | null;
} | null;

export type TelemetryIntelligenceSnapshot = {
  version: 1;
  processedAt: string;
  intelligenceState: "normal" | "elevated" | "incident" | "change_boost";
  alertEnrichment: AlertEnrichmentSnapshot | null;
  serviceMapCorrelation: ServiceMapCorrelationSnapshot | null;
  samplingPolicies: SamplingPolicyDecision[];
  collectorConfigHint: string;
  runtimeInsights?: InvestigationRuntimeInsights;
  clickhouseInsights?: InvestigationRuntimeInsights;
};

export type ChangeEventInput = {
  serviceName: string;
  changeType: "deploy" | "config" | "scale";
  sha?: string;
  author?: string;
  repo?: string;
};

export type TelemetryIntelligenceConfig = {
  baselineSampleRate: number;
  elevatedSampleRate: number;
  incidentSampleRate: number;
  changeBoostSampleRate: number;
  changeBoostWindowMs: number;
  incidentWindowMs: number;
  cooldownWindowMs: number;
  clickhouseUrl: string | null;
  clickhouseEnabled: boolean;
};

export type SignozWebhookHandler = (
  payload: SignozWebhookPayload,
) => Promise<{ investigationIds: string[] }>;
