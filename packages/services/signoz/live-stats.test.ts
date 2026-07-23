import { describe, expect, it } from "vitest";

import { computeLiveTraceStats } from "./live-stats";

describe("computeLiveTraceStats", () => {
  it("aggregates services and classifies errors/slow spans", () => {
    const stats = computeLiveTraceStats([
      {
        serviceName: "evolvex-api",
        durationMs: 120,
        hasError: false,
      },
      {
        serviceName: "evolvex-api",
        durationMs: 900,
        hasError: false,
      },
      {
        serviceName: "payments-svc",
        durationMs: 200,
        hasError: true,
      },
    ]);

    expect(stats.total).toBe(3);
    expect(stats.errors).toBe(1);
    expect(stats.slow).toBe(1);
    expect(stats.evolvexApiCount).toBe(2);
    expect(stats.byService[0]).toEqual({ service: "evolvex-api", count: 2 });
  });
});
