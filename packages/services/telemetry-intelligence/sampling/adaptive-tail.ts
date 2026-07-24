import type { AlertClassification } from "../../signoz/alert-classifier";
import { getTelemetryIntelligenceConfig } from "../config";
import type { SamplingPolicyDecision } from "../types";

/** Feature #1 — dynamic tail sampling from alert severity and classification. */
export function computeAdaptiveTailSampling(input: {
  serviceName: string;
  classification: AlertClassification;
  severity: string | null;
  triggerSource?: string;
}): SamplingPolicyDecision {
  const config = getTelemetryIntelligenceConfig();
  const severity = (input.severity ?? "").toLowerCase();
  const triggerSource = input.triggerSource ?? "adaptive-tail";

  if (severity === "critical" || input.classification.kind === "error") {
    return {
      serviceName: input.serviceName,
      mode: "incident",
      sampleRate: config.incidentSampleRate,
      reason: "Critical/error alert — capture 100% traces for accurate tail latency RCA.",
      triggerSource,
      expiresAt: new Date(Date.now() + config.incidentWindowMs),
      metadata: { feature: "#1", classification: input.classification },
    };
  }

  if (input.classification.kind === "latency_percentile") {
    const percentile = input.classification.percentile ?? "p99";
    const elevated = percentile === "p99" || percentile === "p95";
    return {
      serviceName: input.serviceName,
      mode: elevated ? "elevated" : "elevated",
      sampleRate: elevated ? config.elevatedSampleRate : config.baselineSampleRate * 2,
      reason: `${percentile.toUpperCase()} latency alert — boost tail sampling.`,
      triggerSource,
      expiresAt: new Date(Date.now() + config.incidentWindowMs),
      metadata: { feature: "#1", percentile },
    };
  }

  return {
    serviceName: input.serviceName,
    mode: "normal",
    sampleRate: config.baselineSampleRate,
    reason: "Normal traffic — baseline adaptive sampling.",
    triggerSource,
    expiresAt: new Date(Date.now() + config.cooldownWindowMs),
    metadata: { feature: "#1" },
  };
}
