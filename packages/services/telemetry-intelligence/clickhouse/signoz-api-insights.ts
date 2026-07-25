import { signozClient } from "../../signoz/client";

import type { InvestigationInsights } from "./investigation-insights";

/** Feature #5 — SigNoz Cloud fallback when direct ClickHouse is unavailable. */
export async function buildSignozApiInvestigationInsights(input: {
  serviceName: string;
  windowMinutes?: number;
  endpointLimit?: number;
}): Promise<InvestigationInsights | null> {
  if (!signozClient.isConfigured()) return null;

  const windowMinutes = input.windowMinutes ?? 15;
  const endpointLimit = input.endpointLimit ?? 5;
  const endMs = Date.now();
  const startMs = endMs - windowMinutes * 60 * 1000;
  const started = Date.now();

  const [allTraces, errorTraces] = await Promise.all([
    signozClient.searchTracesInWindow({
      serviceName: input.serviceName,
      startMs,
      endMs,
      limit: 200,
    }),
    signozClient.searchErrorTraces({
      serviceName: input.serviceName,
      startMs,
      endMs,
      limit: 100,
    }),
  ]);

  if (allTraces.length === 0 && errorTraces.length === 0) return null;

  const durations = allTraces
    .map((trace) => trace.durationMs)
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);
  const p99Index = Math.max(0, Math.ceil(durations.length * 0.99) - 1);
  const p99Ms = durations.length > 0 ? (durations[p99Index] ?? null) : null;

  const endpointMap = new Map<string, { errorCount: number; p99Ms: number | null }>();
  for (const trace of errorTraces) {
    const endpoint = trace.name || "unknown";
    const existing = endpointMap.get(endpoint) ?? { errorCount: 0, p99Ms: null };
    existing.errorCount += 1;
    if (trace.durationMs != null) {
      existing.p99Ms =
        existing.p99Ms == null ? trace.durationMs : Math.max(existing.p99Ms, trace.durationMs);
    }
    endpointMap.set(endpoint, existing);
  }

  const topFailingEndpoints = [...endpointMap.entries()]
    .map(([endpoint, stats]) => ({
      endpoint,
      errorCount: stats.errorCount,
      p99Ms: stats.p99Ms,
    }))
    .sort((a, b) => b.errorCount - a.errorCount)
    .slice(0, endpointLimit);

  return {
    enabled: true,
    serviceName: input.serviceName,
    windowMinutes,
    source: "signoz_api",
    materializedViewsAvailable: false,
    latencySummary: {
      requests: allTraces.length,
      errors: errorTraces.length,
      p99Ms,
    },
    topFailingEndpoints,
    queryElapsedMs: Date.now() - started,
  };
}
