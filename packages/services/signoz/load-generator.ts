import { logger } from "@repo/logger";

import { getDefaultServiceName } from "../signoz-env";
import { ingestMetrics, ingestTraces } from "./otel-ingest";

export type LoadGeneratorConfig = {
  ingestionKey: string;
  ingestionUrl?: string;
  serviceName?: string;
  baselineIntervalMs?: number;
  spikeIntervalMs?: number;
  baselineSuccessTraces?: number;
  spikeErrorTraces?: number;
  spikeMetricIncrement?: number;
};

export type LoadGeneratorStats = {
  ticks: number;
  spikes: number;
  lastBaselineAt: string | null;
  lastSpikeAt: string | null;
  lastError: string | null;
};

function readInt(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadGeneratorConfigFromEnv(): LoadGeneratorConfig | null {
  const ingestionKey = process.env.SIGNOZ_INGESTION_KEY?.trim();
  if (!ingestionKey) return null;

  return {
    ingestionKey,
    ingestionUrl: process.env.SIGNOZ_INGESTION_URL,
    serviceName: getDefaultServiceName(),
    baselineIntervalMs: readInt("SIGNOZ_LOAD_BASELINE_MS", 8_000),
    spikeIntervalMs: readInt("SIGNOZ_LOAD_SPIKE_MS", 90_000),
    baselineSuccessTraces: readInt("SIGNOZ_LOAD_BASELINE_TRACES", 2),
    spikeErrorTraces: readInt("SIGNOZ_LOAD_SPIKE_ERRORS", 5),
    spikeMetricIncrement: readInt("SIGNOZ_LOAD_SPIKE_METRIC", 12),
  };
}

export class SignozLoadGenerator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private stats: LoadGeneratorStats = {
    ticks: 0,
    spikes: 0,
    lastBaselineAt: null,
    lastSpikeAt: null,
    lastError: null,
  };

  constructor(private readonly config: LoadGeneratorConfig) {}

  getStats() {
    return { ...this.stats, uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0 };
  }

  async tick(forceSpike = false) {
    const serviceName = this.config.serviceName ?? getDefaultServiceName();
    const spikeDue =
      forceSpike ||
      (this.stats.spikes === 0 && this.stats.ticks === 0) ||
      (this.stats.lastSpikeAt
        ? Date.now() - new Date(this.stats.lastSpikeAt).getTime() >= (this.config.spikeIntervalMs ?? 90_000)
        : true);

    try {
      if (spikeDue) {
        await ingestTraces(
          {
            ingestionKey: this.config.ingestionKey,
            ingestionUrl: this.config.ingestionUrl,
          },
          {
            serviceName,
            errorCount: this.config.spikeErrorTraces ?? 5,
            successCount: 1,
          },
        );
        await ingestMetrics(
          {
            ingestionKey: this.config.ingestionKey,
            ingestionUrl: this.config.ingestionUrl,
          },
          serviceName,
          this.config.spikeMetricIncrement ?? 12,
        );
        this.stats.spikes += 1;
        this.stats.lastSpikeAt = new Date().toISOString();
        logger.info("SigNoz loadgen spike sent", {
          serviceName,
          errors: this.config.spikeErrorTraces,
        });
      } else {
        await ingestTraces(
          {
            ingestionKey: this.config.ingestionKey,
            ingestionUrl: this.config.ingestionUrl,
          },
          {
            serviceName,
            errorCount: 0,
            successCount: this.config.baselineSuccessTraces ?? 2,
          },
        );
        this.stats.lastBaselineAt = new Date().toISOString();
      }

      this.stats.ticks += 1;
      this.stats.lastError = null;
    } catch (err) {
      this.stats.lastError = err instanceof Error ? err.message : String(err);
      logger.error("SigNoz loadgen tick failed", { message: this.stats.lastError });
      throw err;
    }
  }

  start() {
    if (this.timer) return;
    this.startedAt = Date.now();
    const intervalMs = this.config.baselineIntervalMs ?? 8_000;

    void this.tick(true);
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, intervalMs);

    logger.info("SigNoz load generator started", {
      serviceName: this.config.serviceName ?? getDefaultServiceName(),
      baselineIntervalMs: intervalMs,
      spikeIntervalMs: this.config.spikeIntervalMs,
    });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
