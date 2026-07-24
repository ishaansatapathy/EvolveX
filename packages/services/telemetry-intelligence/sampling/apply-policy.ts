import { logger } from "@repo/logger";

import { getDefaultServiceName } from "../../signoz-env";
import { ingestTraces } from "../../signoz/otel-ingest";
import type { SamplingPolicyDecision } from "../types";

/** Apply elevated sampling by emitting boosted OTLP trace batches when ingestion key is configured. */
export async function applySamplingPolicyBoost(policy: SamplingPolicyDecision) {
  if (policy.sampleRate < 0.5 || policy.mode === "normal" || policy.mode === "cooldown") {
    return { applied: false, reason: "Policy below boost threshold" };
  }

  const ingestionKey = process.env.SIGNOZ_INGESTION_KEY?.trim();
  if (!ingestionKey) {
    return { applied: false, reason: "SIGNOZ_INGESTION_KEY not configured" };
  }

  const fastCount = Math.round(8 + policy.sampleRate * 12);
  const tailCount = policy.mode === "incident" || policy.mode === "change_boost" ? 4 : 2;

  try {
    await ingestTraces(
      { ingestionKey, ingestionUrl: process.env.SIGNOZ_INGESTION_URL },
      {
        serviceName: policy.serviceName || getDefaultServiceName(),
        errorCount: policy.mode === "incident" ? 1 : 0,
        fastSuccessCount: fastCount,
        tailLatencyCount: tailCount,
        tailLatencyMs: 4800,
      },
    );

    logger.info("Applied telemetry intelligence sampling boost", {
      service: policy.serviceName,
      mode: policy.mode,
      sampleRate: policy.sampleRate,
    });

    return { applied: true, fastCount, tailCount };
  } catch (err) {
    logger.warn("Sampling boost OTLP ingest failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return { applied: false, reason: "OTLP ingest failed" };
  }
}
