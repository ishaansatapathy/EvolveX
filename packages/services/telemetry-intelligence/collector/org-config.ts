import { resolveSignozConfig } from "../../organization/integrations";
import { getIntegrationBaseUrl } from "../../integrations/config";
import { getDefaultServiceName } from "../../signoz-env";
import { listActiveSamplingPolicies } from "../sampling/policy-store";
import { generateCollectorConfig } from "./config-generator";

function resolveSignozOtlpEndpoint(cloudUrl?: string | null) {
  const fromEnv = process.env.SIGNOZ_OTLP_ENDPOINT?.trim();
  if (fromEnv) return fromEnv;

  if (cloudUrl) {
    try {
      const host = new URL(cloudUrl).hostname;
      if (host.includes("signoz.cloud")) {
        return "ingest.signoz.cloud:4317";
      }
    } catch {
      // ignore invalid URL
    }
  }

  return "ingest.signoz.cloud:4317";
}

function resolveSignozIngestionKey(secrets?: Record<string, unknown>) {
  const vaultKey = typeof secrets?.ingestionKey === "string" ? secrets.ingestionKey.trim() : "";
  return vaultKey || process.env.SIGNOZ_INGESTION_KEY?.trim() || undefined;
}

/** Feature #31 — org-scoped collector YAML with live sampling policies. */
export async function buildCollectorConfigForOrganization(input: {
  organizationId: string;
  services?: string[];
  namespaces?: Array<{ name: string; sampleRatePct: number }>;
}) {
  const [signozConfig, policies] = await Promise.all([
    resolveSignozConfig(input.organizationId),
    listActiveSamplingPolicies({ organizationId: input.organizationId }),
  ]);

  const evolvexApiUrl = getIntegrationBaseUrl();
  const signozOtlpEndpoint = resolveSignozOtlpEndpoint(signozConfig?.cloudUrl ?? null);
  const signozIngestionKey = resolveSignozIngestionKey(
    signozConfig ? { ingestionKey: process.env.SIGNOZ_INGESTION_KEY } : undefined,
  );

  const services =
    input.services && input.services.length > 0
      ? input.services
      : [getDefaultServiceName()];

  const namespaceRules =
    input.namespaces ??
    [
      { name: "production", sampleRatePct: 100 },
      { name: "staging", sampleRatePct: 35 },
      { name: "dev", sampleRatePct: 15 },
    ];

  const yaml = generateCollectorConfig({
    evolvexApiUrl,
    signozOtlpEndpoint,
    signozIngestionKey,
    services,
    activePolicies: policies,
    namespaces: namespaceRules,
    organizationId: input.organizationId,
  });

  return {
    yaml,
    evolvexApiUrl,
    signozOtlpEndpoint,
    activePolicyCount: policies.length,
    services,
    namespaces: namespaceRules,
  };
}
