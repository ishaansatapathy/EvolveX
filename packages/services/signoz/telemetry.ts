import { isSignozConfigured } from "../signoz-env";
import { signozClient } from "./client";
import { fetchSignozDependencies, fetchSignozServices } from "./service-map";
import type { SignozLogRow, SignozTraceRow } from "./types";

export type TelemetryRange = "15m" | "1h" | "6h";

const RANGE_MS: Record<TelemetryRange, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
};

function windowForRange(range: TelemetryRange) {
  const endMs = Date.now();
  return { startMs: endMs - RANGE_MS[range], endMs };
}

export function assertSignozTelemetryAvailable() {
  if (!isSignozConfigured()) {
    throw new Error("SigNoz is not configured. Set SIGNOZ_CLOUD_URL and SIGNOZ_API_KEY.");
  }
}

export async function queryRecentTraces(input: {
  serviceName?: string;
  range?: TelemetryRange;
  limit?: number;
}): Promise<SignozTraceRow[]> {
  assertSignozTelemetryAvailable();
  const { startMs, endMs } = windowForRange(input.range ?? "15m");
  return signozClient.searchTracesInWindow({
    serviceName: input.serviceName,
    startMs,
    endMs,
    limit: input.limit ?? 50,
  });
}

export async function queryRecentLogs(input: {
  serviceName?: string;
  range?: TelemetryRange;
  limit?: number;
}): Promise<SignozLogRow[]> {
  assertSignozTelemetryAvailable();
  const { startMs, endMs } = windowForRange(input.range ?? "15m");
  return signozClient.searchLogs({
    serviceName: input.serviceName,
    startMs,
    endMs,
    limit: input.limit ?? 50,
  });
}

export async function queryServiceMap(input?: { serviceName?: string }) {
  assertSignozTelemetryAvailable();
  const [services, edges] = await Promise.all([
    fetchSignozServices(),
    fetchSignozDependencies(input?.serviceName ? { service: input.serviceName } : undefined),
  ]);
  return { services, edges };
}

export async function queryServiceMetrics(range: TelemetryRange = "1h") {
  assertSignozTelemetryAvailable();
  const services = await fetchSignozServices();
  const { endMs } = windowForRange(range);
  return services.map((svc) => ({
    serviceName: svc.name,
    p99Ms: svc.latencyMs,
    healthy: svc.healthy,
    queriedAt: new Date(endMs).toISOString(),
    range,
  }));
}
