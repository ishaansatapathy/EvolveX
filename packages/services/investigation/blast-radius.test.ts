import { describe, expect, it } from "vitest";

import { computeBlastRadius } from "./blast-radius";

describe("computeBlastRadius", () => {
  it("ranks downstream services by evidence and health signals", () => {
    const result = computeBlastRadius({
      primaryService: "payments-svc",
      dependencies: {
        nodes: [
          { id: "1", name: "payments-svc", healthy: false, latencyMs: 920 },
          { id: "2", name: "checkout-api", healthy: false, latencyMs: 800 },
          { id: "3", name: "redis", healthy: true, latencyMs: 20 },
        ],
        edges: [
          { id: "e1", source: "checkout-api", destination: "payments-svc", healthy: false, latencyMs: 800 },
          { id: "e2", source: "payments-svc", destination: "redis", healthy: true, latencyMs: 20 },
        ],
      },
      timeline: [
        {
          id: "t1",
          occurredAt: "2026-01-01T12:00:00.000Z",
          kind: "TRACE",
          title: "Slow span on checkout-api",
          detail: "GET /checkout",
          source: "signoz",
          sourceRef: null,
        },
      ],
      runtimeSignals: [
        {
          id: "r1",
          traceId: "abc",
          service: "payments-svc",
          metric: "latency",
          latencyMs: 920,
          p95Ms: 900,
          p99Ms: 920,
          errorRate: null,
          signalTimestamp: "2026-01-01T12:00:00.000Z",
          metadata: {},
        },
      ],
    });

    expect(result.totalAffected).toBeGreaterThan(0);
    expect(result.impacts[0]?.service).toBe("payments-svc");
    expect(result.impacts.some((item) => item.service === "checkout-api")).toBe(true);
    expect(result.summary).toContain("dependent service");
  });
});
