import { getTelemetryIntelligenceConfig } from "../config";
import type { ChangeEventInput, SamplingPolicyDecision } from "../types";

/** Feature #8 — 100% sampling for 30 minutes after deployment/change. */
export function computeChangeAwareSampling(input: ChangeEventInput): SamplingPolicyDecision {
  const config = getTelemetryIntelligenceConfig();

  return {
    serviceName: input.serviceName,
    mode: "change_boost",
    sampleRate: config.changeBoostSampleRate,
    reason: `Change detected (${input.changeType}) — full trace capture for post-change diagnosis.`,
    triggerSource: "change-aware",
    expiresAt: new Date(Date.now() + config.changeBoostWindowMs),
    metadata: {
      feature: "#8",
      changeType: input.changeType,
      sha: input.sha,
      author: input.author,
      repo: input.repo,
    },
  };
}
