import { getTelemetryIntelligenceConfig } from "../config";
import type { SamplingPolicyDecision } from "../types";
import { buildCollectorEnrichmentSpec, COLLECTOR_EXTENSION_PROCESSOR_NAME } from "./extension-spec";

/** Feature #2 + #31 — render OTel Collector YAML with Evolvex enrichment processor. */
export function generateCollectorConfig(input: {
  evolvexApiUrl: string;
  signozOtlpEndpoint: string;
  signozIngestionKey?: string;
  services?: string[];
  activePolicies?: SamplingPolicyDecision[];
  namespaces?: Array<{ name: string; sampleRatePct: number }>;
  organizationId?: string;
}) {
  const config = getTelemetryIntelligenceConfig();
  const primaryPolicy = input.activePolicies?.[0];
  const enrichment = buildCollectorEnrichmentSpec({
    samplingMode: primaryPolicy?.mode ?? "normal",
    samplingRate: primaryPolicy?.sampleRate ?? config.baselineSampleRate,
    organizationId: input.organizationId,
  });

  const tailSamplingPct =
    primaryPolicy?.sampleRate != null
      ? Math.round(primaryPolicy.sampleRate * 100)
      : Math.round(config.baselineSampleRate * 100);

  const namespaceRules = input.namespaces ?? [];
  const namespacePolicyYaml =
    namespaceRules.length > 0
      ? namespaceRules
          .map(
            (rule) => `      - name: evolvex-namespace-${rule.name}
        type: and
        and:
          and_sub_policy:
            - name: namespace-match
              type: string_attribute
              string_attribute:
                key: k8s.namespace.name
                values: ["${rule.name}"]
            - name: namespace-rate
              type: probabilistic
              probabilistic:
                sampling_percentage: ${Math.min(100, Math.max(5, rule.sampleRatePct))}`,
          )
          .join("\n")
      : "";

  const serviceHints =
    input.services && input.services.length > 0
      ? input.services.map((service) => `- ${service}`).join("\n")
      : "- payment-service";

  return `# Evolvex Telemetry Intelligence — OTel Collector config (Feature #31)
# Organization: ${input.organizationId ?? "global"}
# Poll sampling policies: ${input.evolvexApiUrl}/telemetry-intelligence/sampling-policies
# Services prioritized:
${serviceHints}

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch: {}

  attributes/${COLLECTOR_EXTENSION_PROCESSOR_NAME}:
    actions:
${Object.entries(enrichment)
  .map(([key, value]) => `      - key: ${key}\n        action: upsert\n        value: "${value}"`)
  .join("\n")}

  tail_sampling:
    decision_wait: 10s
    policies:
      - name: evolvex-incident-boost
        type: probabilistic
        probabilistic:
          sampling_percentage: ${Math.min(100, Math.max(tailSamplingPct, 10))}
      - name: evolvex-error-traces
        type: status_code
        status_code:
          status_codes: [ERROR]
${namespacePolicyYaml ? `${namespacePolicyYaml}\n` : ""}
exporters:
  otlp/signoz:
    endpoint: ${input.signozOtlpEndpoint}
    headers:
      signoz-ingestion-key: \${SIGNOZ_INGESTION_KEY}

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors:
        - attributes/${COLLECTOR_EXTENSION_PROCESSOR_NAME}
        - tail_sampling
        - batch
      exporters: [otlp/signoz]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/signoz]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/signoz]
`;
}
