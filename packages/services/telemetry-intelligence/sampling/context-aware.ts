import { getTelemetryIntelligenceConfig } from "../config";
import type { AlertClassification } from "../../signoz/alert-classifier";
import type { SamplingPolicyDecision } from "../types";

/** Feature #7 — collection intensity from alert class, service criticality, graph depth. */
export function computeContextAwareSampling(input: {
  serviceName: string;
  classification: AlertClassification;
  severity: string | null;
  graphDepth: number;
  isCriticalService: boolean;
}): SamplingPolicyDecision {
  const config = getTelemetryIntelligenceConfig();
  const graphBoost = Math.min(input.graphDepth * 0.1, 0.3);
  const criticalBoost = input.isCriticalService ? 0.2 : 0;
  const severityBoost = (input.severity ?? "").toLowerCase() === "critical" ? 0.25 : 0;

  let baseRate = config.baselineSampleRate;
  if (input.classification.kind === "error") baseRate = config.incidentSampleRate;
  else if (input.classification.kind === "latency_percentile") baseRate = config.elevatedSampleRate;

  const sampleRate = Math.min(1, baseRate + graphBoost + criticalBoost + severityBoost);

  return {
    serviceName: input.serviceName,
    mode: sampleRate >= config.incidentSampleRate ? "incident" : sampleRate >= config.elevatedSampleRate ? "elevated" : "normal",
    sampleRate,
    reason: `Context-aware intensity (graph depth ${input.graphDepth}, critical=${input.isCriticalService}).`,
    triggerSource: "context-aware",
    expiresAt: new Date(Date.now() + config.incidentWindowMs),
    metadata: {
      feature: "#7",
      graphDepth: input.graphDepth,
      isCriticalService: input.isCriticalService,
    },
  };
}

/** Merge multiple sampling decisions — highest sample rate wins. */
export function mergeSamplingPolicies(policies: SamplingPolicyDecision[]): SamplingPolicyDecision | null {
  if (policies.length === 0) return null;

  return policies.reduce((best, current) => {
    if (current.sampleRate > best.sampleRate) return current;
    if (current.sampleRate === best.sampleRate && current.mode === "incident") return current;
    return best;
  });
}

const CRITICAL_SERVICE_HINTS = ["payment", "checkout", "auth", "gateway", "order"];

export function isCriticalServiceName(serviceName: string) {
  const lower = serviceName.toLowerCase();
  return CRITICAL_SERVICE_HINTS.some((hint) => lower.includes(hint));
}
