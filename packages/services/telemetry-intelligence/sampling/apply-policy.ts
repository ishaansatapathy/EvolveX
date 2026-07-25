import { logger } from "@repo/logger";

import { getDefaultServiceName } from "../../signoz-env";
import type { SamplingPolicyDecision } from "../types";

/** Production: sampling is enforced by collector tail_sampling — policies are pulled via HTTP. */
export async function applySamplingPolicyBoost(policy: SamplingPolicyDecision) {
  const isProd = process.env.NODE_ENV === "production";
  const allowDevBoost = process.env.TI_ENABLE_OTLP_BOOST === "true";

  if (isProd && !allowDevBoost) {
    return {
      applied: false,
      reason:
        "Collector tail_sampling active — agents pull /telemetry-intelligence/collector-config",
    };
  }

  if (policy.sampleRate < 0.5 || policy.mode === "normal" || policy.mode === "cooldown") {
    return { applied: false, reason: "Policy below boost threshold" };
  }

  const ingestionKey = process.env.SIGNOZ_INGESTION_KEY?.trim();
  if (!ingestionKey) {
    return { applied: false, reason: "SIGNOZ_INGESTION_KEY not configured" };
  }

  const { ingestTraces } = await import("../../signoz/otel-ingest");

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

    logger.info("Applied dev-only telemetry intelligence OTLP boost", {
      service: policy.serviceName,
      mode: policy.mode,
      sampleRate: policy.sampleRate,
    });

    return { applied: true, fastCount, tailCount, devOnly: true };
  } catch (err) {
    logger.warn("Sampling boost OTLP ingest failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return { applied: false, reason: "OTLP ingest failed" };
  }
}
