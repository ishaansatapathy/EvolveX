import { describe, expect, it } from "vitest";

import { computeCrossServiceRca } from "./cross-service-rca";

describe("computeCrossServiceRca", () => {
  it("ranks upstream propagation paths toward the alert origin", () => {
    const result = computeCrossServiceRca({
      primaryService: "payments-svc",
      dependencies: {
        nodes: [
          { id: "1", name: "checkout-api", healthy: false, latencyMs: 880 },
          { id: "2", name: "payments-svc", healthy: false, latencyMs: 920 },
          { id: "3", name: "redis", healthy: true, latencyMs: 20 },
        ],
        edges: [
          { id: "e1", source: "checkout-api", destination: "payments-svc", healthy: false, latencyMs: 880 },
          { id: "e2", source: "payments-svc", destination: "redis", healthy: true, latencyMs: 20 },
        ],
      },
      timeline: [
        {
          id: "t1",
          occurredAt: "2026-01-01T12:00:00.000Z",
          kind: "TRACE",
          title: "Slow span on checkout-api",
          detail: "checkout-api timeout calling payments-svc",
          source: "signoz",
          sourceRef: null,
        },
        {
          id: "t2",
          occurredAt: "2026-01-01T12:01:00.000Z",
          kind: "ALERT",
          title: "High latency on payments-svc",
          detail: "p99 above threshold",
          source: "signoz",
          sourceRef: null,
        },
      ],
      runtimeSignals: [],
      changeEvents: [],
      citationRefByTimelineId: new Map([
        ["t1", "T1"],
        ["t2", "T2"],
      ]),
    });

    expect(result.paths.length).toBeGreaterThan(0);
    const upstream = result.paths.find((path) => path.direction === "upstream_cause");
    expect(upstream?.services).toEqual(["checkout-api", "payments-svc"]);
    expect(upstream?.hops.some((hop) => hop.citationRefs.includes("T1"))).toBe(true);
    expect(result.summary).toContain("checkout-api");
  });
});
