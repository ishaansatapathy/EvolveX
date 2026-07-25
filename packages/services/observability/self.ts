import { getSharedCountersMerged } from "./counters";
import { isRedisConfigured } from "../cache/kv-store";
import { isSignozIngestionConfigured } from "../integrations/config";
import { getSignozConfig, isProductionEnvironment } from "../signoz-env";

export type SelfObservabilitySnapshot = {
  generatedAt: string;
  serviceName: string;
  otel: {
    enabled: boolean;
    sdkDisabled: boolean;
    ingestionConfigured: boolean;
    serviceName: string;
    deploymentEnvironment: string;
    ingestionUrl: string | null;
    /** Runtime metrics (event loop, GC, heap, HTTP histograms) exported alongside traces — see register-otel.ts */
    metricsEnabled: boolean;
    /** @repo/logger (winston) calls bridged to OTel log records with trace_id/span_id correlation */
    logsEnabled: boolean;
  };
  traceExplorerUrl: string | null;
  counters: Record<string, number>;
  counterHighlights: Array<{ name: string; label: string; value: number }>;
  rateLimiting: {
    enabled: boolean;
    backend: "redis" | "in-process";
    notes: string[];
  };
  security: {
    productionMode: boolean;
    helmetEnabled: true;
    jwtConfigured: boolean;
    webhookSecretsConfigured: boolean;
    skipEnvValidation: boolean;
  };
  notes: string[];
};

function buildTraceExplorerUrl(serviceName: string) {
  const config = getSignozConfig();
  if (!config?.cloudUrl) return null;
  const base = config.cloudUrl.replace(/\/+$/, "");
  const params = new URLSearchParams({
    service: serviceName,
  });
  return `${base}/services/${encodeURIComponent(serviceName)}?${params.toString()}`;
}

function highlightCounters(counters: Record<string, number>) {
  const labels: Record<string, string> = {
    "investigation.created": "Investigations created",
    "investigation.ready": "Investigations ready",
    "investigation.failed": "Investigations failed",
    "webhook.signoz.received": "SigNoz webhooks",
    "webhook.github.received": "GitHub webhooks",
    "llm.summary.generated": "LLM summaries",
    "inbox.cache_hit": "Inbox cache hits",
  };

  return Object.entries(counters)
    .filter(([name]) => labels[name] || name.startsWith("mcp.tool."))
    .map(([name, value]) => ({
      name,
      label: labels[name] ?? name.replaceAll(".", " "),
      value,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

/** Feature #39 — Evolvex operational snapshot (dogfooding SigNoz). */
export async function buildSelfObservabilitySnapshot(input?: {
  serviceName?: string;
}): Promise<SelfObservabilitySnapshot> {
  const serviceName = input?.serviceName?.trim() || process.env.OTEL_SERVICE_NAME?.trim() || "evolvex-api";
  const sdkDisabled = process.env.OTEL_SDK_DISABLED === "true";
  const ingestionConfigured = isSignozIngestionConfigured();
  const counters = await getSharedCountersMerged();

  return {
    generatedAt: new Date().toISOString(),
    serviceName,
    otel: {
      enabled: ingestionConfigured && !sdkDisabled,
      sdkDisabled,
      ingestionConfigured,
      serviceName,
      deploymentEnvironment: process.env.NODE_ENV ?? "development",
      ingestionUrl: process.env.SIGNOZ_INGESTION_URL?.trim() ?? null,
      metricsEnabled: ingestionConfigured && !sdkDisabled && process.env.OTEL_METRICS_EXPORTER !== "none",
      logsEnabled: ingestionConfigured && !sdkDisabled && process.env.OTEL_LOGS_EXPORTER !== "none",
    },
    traceExplorerUrl: buildTraceExplorerUrl(serviceName),
    counters,
    counterHighlights: highlightCounters(counters),
    rateLimiting: {
      enabled: process.env.VITEST !== "true",
      backend: isRedisConfigured() ? "redis" : "in-process",
      notes: [
        "Auth, password reset, agent chat, and tRPC routes are rate limited.",
        isRedisConfigured()
          ? "Redis-backed counters shared across API instances."
          : "In-process limits per API instance (set REDIS_URL for multi-instance deploys).",
      ],
    },
    security: {
      productionMode: isProductionEnvironment(),
      helmetEnabled: true,
      jwtConfigured: Boolean(process.env.JWT_SECRET?.trim() && process.env.JWT_REFRESH_SECRET?.trim()),
      webhookSecretsConfigured: Boolean(
        process.env.SIGNOZ_WEBHOOK_SECRET?.trim() || process.env.GITHUB_WEBHOOK_SECRET?.trim(),
      ),
      skipEnvValidation: process.env.SKIP_ENV_VALIDATION === "true",
    },
    notes: [
      "Evolvex exports its own traces, runtime metrics, and application logs (all three pillars) when " +
        "SIGNOZ_INGESTION_KEY is configured (#39/#40).",
      "Use the SigNoz link below to inspect API request latency and dependency spans.",
    ],
  };
}
