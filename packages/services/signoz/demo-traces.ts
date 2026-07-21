import type { SignozTraceRow } from "./types";

export function isDemoTracesEnabled() {
  return process.env.SIGNOZ_DEMO_TRACES === "true";
}

export function buildDemoErrorTraces(serviceName: string): SignozTraceRow[] {
  const now = Date.now();
  return [
    {
      traceId: "a1b2c3d4e5f6789012345678abcdef01",
      spanId: "span000000000001",
      serviceName,
      name: "POST /checkout",
      durationMs: 842,
      hasError: true,
      timestamp: new Date(now - 2 * 60_000).toISOString(),
    },
    {
      traceId: "a1b2c3d4e5f6789012345678abcdef02",
      spanId: "span000000000002",
      serviceName,
      name: "CartMapper.load",
      durationMs: 612,
      hasError: true,
      timestamp: new Date(now - 90_000).toISOString(),
    },
    {
      traceId: "a1b2c3d4e5f6789012345678abcdef03",
      spanId: "span000000000003",
      serviceName,
      name: "db.query.batch",
      durationMs: 455,
      hasError: true,
      timestamp: new Date(now - 45_000).toISOString(),
    },
  ];
}
