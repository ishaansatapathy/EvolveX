import { describe, expect, it, vi } from "vitest";

import { computeServiceMapDeepCorrelation } from "./service-map-deep-correlation";

vi.mock("../telemetry-intelligence/service-map/deep-correlation", () => ({
  buildServiceMapDeepCorrelation: vi.fn(async ({ primaryService }: { primaryService: string }) => ({
    primaryService,
    upstream: ["checkout-api"],
    downstream: ["redis-cache"],
    affectedServices: [primaryService, "checkout-api", "redis-cache"],
    propagationPaths: [["checkout-api", primaryService, "redis-cache"]],
  })),
}));

describe("service map deep correlation (#6)", () => {
  it("builds suspect services from graph + timeline evidence", async () => {
    const result = await computeServiceMapDeepCorrelation({
      primaryService: "payments-svc",
      organizationId: null,
      dependencies: {
        nodes: [
          { id: "1", name: "payments-svc", healthy: false, latencyMs: 920 },
          { id: "2", name: "checkout-api", healthy: true, latencyMs: 120 },
          { id: "3", name: "redis-cache", healthy: false, latencyMs: 40 },
        ],
        edges: [
          { id: "e1", source: "checkout-api", destination: "payments-svc", healthy: true, latencyMs: 80 },
          { id: "e2", source: "payments-svc", destination: "redis-cache", healthy: false, latencyMs: 35 },
        ],
      },
      timeline: [
        {
          id: "t1",
          occurredAt: "2026-07-25T08:52:00.000Z",
          kind: "LOG",
          title: "checkout-api timeout calling payments-svc",
          detail: "upstream latency",
          source: "signoz",
          sourceRef: null,
          sortOrder: 1,
        },
      ],
      runtimeSignals: [],
      changeEvents: [
        {
          id: "c1",
          type: "deployment",
          service: "checkout-api",
          author: "alex",
          occurredAt: "2026-07-25T08:50:00.000Z",
          metadata: {},
        },
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.graphDepth).toBeGreaterThan(0);
    expect(result!.upstream).toContain("checkout-api");
    expect(result!.downstream).toContain("redis-cache");
    expect(result!.suspectServices[0]?.service).toBe("checkout-api");
    expect(result!.propagationPaths.length).toBeGreaterThan(0);
  });

  it("returns null without a primary service", async () => {
    const result = await computeServiceMapDeepCorrelation({
      primaryService: null,
      dependencies: { nodes: [], edges: [] },
      timeline: [],
      runtimeSignals: [],
      changeEvents: [],
    });
    expect(result).toBeNull();
  });
});
