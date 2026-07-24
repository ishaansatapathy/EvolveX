import type { TelemetryIntelligenceConfig } from "./types";

function readFloat(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readInt(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Env-driven telemetry intelligence tuning knobs. */
export function getTelemetryIntelligenceConfig(): TelemetryIntelligenceConfig {
  const clickhouseUrl = process.env.SIGNOZ_CLICKHOUSE_URL?.trim() || null;

  return {
    baselineSampleRate: readFloat("TI_BASELINE_SAMPLE_RATE", 0.1),
    elevatedSampleRate: readFloat("TI_ELEVATED_SAMPLE_RATE", 0.5),
    incidentSampleRate: readFloat("TI_INCIDENT_SAMPLE_RATE", 1),
    changeBoostSampleRate: readFloat("TI_CHANGE_BOOST_SAMPLE_RATE", 1),
    changeBoostWindowMs: readInt("TI_CHANGE_BOOST_WINDOW_MS", 30 * 60 * 1000),
    incidentWindowMs: readInt("TI_INCIDENT_WINDOW_MS", 20 * 60 * 1000),
    cooldownWindowMs: readInt("TI_COOLDOWN_WINDOW_MS", 10 * 60 * 1000),
    clickhouseUrl,
    clickhouseEnabled: Boolean(clickhouseUrl),
  };
}
