import { getTelemetryIntelligenceConfig } from "../config";
import type { SamplingPolicyDecision } from "../types";
import { buildCollectorEnrichmentSpec, COLLECTOR_EXTENSION_PROCESSOR_NAME } from "./extension-spec";

function resolveTailLatencyThresholdMs(policies: SamplingPolicyDecision[]) {
  const incident = policies.some((policy) => policy.mode === "incident" || policy.mode === "change_boost");
  if (incident) return 400;
  const elevated = policies.some((policy) => policy.mode === "elevated");
  if (elevated) return 800;
  return 1200;
}

function useGoEnrichmentProcessor() {
  return process.env.TI_USE_GO_PROCESSOR?.trim().toLowerCase() === "true";
}

function renderEnrichmentProcessorBlock(enrichment: ReturnType<typeof buildCollectorEnrichmentSpec>) {
  if (useGoEnrichmentProcessor()) {
    return `  evolvexattributes:
    incident_id: "${enrichment["evolvex.incident_id"] ?? ""}"
    git_sha: "${enrichment["evolvex.git_sha"] ?? ""}"
    deploy_version: "${enrichment["evolvex.deploy_version"] ?? ""}"
    namespace: "${enrichment["evolvex.namespace"] ?? ""}"
    sampling_mode: "${enrichment["evolvex.sampling_mode"] ?? ""}"
    sampling_rate: "${enrichment["evolvex.sampling_rate"] ?? ""}"
    organization_id: "${enrichment["evolvex.organization_id"] ?? ""}"`;
  }

  return `  attributes/${COLLECTOR_EXTENSION_PROCESSOR_NAME}:
    actions:
${Object.entries(enrichment)
  .map(([key, value]) => `      - key: ${key}\n        action: upsert\n        value: "${value}"`)
  .join("\n")}`;
}

function renderEnrichmentPipelineStep() {
  return useGoEnrichmentProcessor() ? "evolvexattributes" : `attributes/${COLLECTOR_EXTENSION_PROCESSOR_NAME}`;
}

/** Feature #2 + #31 — render OTel Collector YAML with Evolvex enrichment + adaptive tail sampling. */
export function generateCollectorConfig(input: {
  evolvexApiUrl: string;
  signozOtlpEndpoint: string;
  signozIngestionKey?: string;
  services?: string[];
  activePolicies?: SamplingPolicyDecision[];
  namespaces?: Array<{ name: string; sampleRatePct: number }>;
  organizationId?: string;
  incidentId?: string;
  gitSha?: string;
  deployVersion?: string;
}) {
  const config = getTelemetryIntelligenceConfig();
  const policies = input.activePolicies ?? [];
  const primaryPolicy =
    policies.length > 0
      ? policies.reduce((best, current) =>
          current.sampleRate > best.sampleRate ? current : best,
        policies[0]!)
      : null;

  const enrichment = buildCollectorEnrichmentSpec({
    incidentId: input.incidentId,
    gitSha: input.gitSha ?? (primaryPolicy?.metadata?.sha as string | undefined),
    deployVersion: input.deployVersion,
    samplingMode: primaryPolicy?.mode ?? "normal",
    samplingRate: primaryPolicy?.sampleRate ?? config.baselineSampleRate,
    organizationId: input.organizationId,
  });

  const tailSamplingPct =
    primaryPolicy?.sampleRate != null
      ? Math.round(primaryPolicy.sampleRate * 100)
      : Math.round(config.baselineSampleRate * 100);

  const latencyThresholdMs = resolveTailLatencyThresholdMs(policies);
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

  const policyPollUrl = input.organizationId
    ? `${input.evolvexApiUrl}/telemetry-intelligence/sampling-policies?organizationId=${input.organizationId}`
    : `${input.evolvexApiUrl}/telemetry-intelligence/sampling-policies`;

  const configPullUrl = input.organizationId
    ? `${input.evolvexApiUrl}/telemetry-intelligence/collector-config?organizationId=${input.organizationId}`
    : `${input.evolvexApiUrl}/telemetry-intelligence/collector-config`;

  return `# Evolvex Telemetry Intelligence — OTel Collector config (Features #1–#2, #31)
# Organization: ${input.organizationId ?? "global"}
# Live policies: ${policyPollUrl}
# Full config pull: ${configPullUrl}
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

${renderEnrichmentProcessorBlock(enrichment)}

  tail_sampling:
    decision_wait: 10s
    num_traces: 100000
    policies:
      - name: evolvex-always-sample-errors
        type: status_code
        status_code:
          status_codes: [ERROR]
      - name: evolvex-latency-tail
        type: latency
        latency:
          threshold_ms: ${latencyThresholdMs}
          upper_threshold_ms: 120000
      - name: evolvex-incident-boost
        type: probabilistic
        probabilistic:
          sampling_percentage: ${Math.min(100, Math.max(tailSamplingPct, 10))}
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
        - ${renderEnrichmentPipelineStep()}
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
