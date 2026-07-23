import type { SignozTraceRow } from "./types";

export type LiveTraceStats = {
  total: number;
  errors: number;
  slow: number;
  byService: Array<{ service: string; count: number }>;
  evolvexApiCount: number;
  evolvexWebCount: number;
  queriedAt: string;
};

const SLOW_MS = Number.parseInt(process.env.SIGNOZ_SLOW_TRACE_MS ?? "800", 10);

export function computeLiveTraceStats(traces: SignozTraceRow[]): LiveTraceStats {
  const byServiceMap = new Map<string, number>();
  let errors = 0;
  let slow = 0;

  for (const trace of traces) {
    const service = trace.serviceName?.trim() || "unknown";
    byServiceMap.set(service, (byServiceMap.get(service) ?? 0) + 1);

    if (trace.hasError) errors += 1;
    else if ((trace.durationMs ?? 0) >= SLOW_MS) slow += 1;
  }

  const byService = [...byServiceMap.entries()]
    .map(([service, count]) => ({ service, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total: traces.length,
    errors,
    slow,
    byService,
    evolvexApiCount: byServiceMap.get("evolvex-api") ?? 0,
    evolvexWebCount: byServiceMap.get("evolvex-web") ?? 0,
    queriedAt: new Date().toISOString(),
  };
}
