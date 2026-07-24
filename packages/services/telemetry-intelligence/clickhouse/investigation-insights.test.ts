import { describe, expect, it } from "vitest";

import type { ClickHouseInvestigationInsights } from "./investigation-insights";

describe("clickhouse investigation insights (#4/#5)", () => {
  it("defines structured insight payload", () => {
    const sample: ClickHouseInvestigationInsights = {
      enabled: true,
      serviceName: "payments-svc",
      windowMinutes: 15,
      source: "native_query",
      materializedViewsAvailable: false,
      latencySummary: { requests: 1200, errors: 42, p99Ms: 520 },
      topFailingEndpoints: [{ endpoint: "POST /checkout", errorCount: 30, p99Ms: 610 }],
      queryElapsedMs: 18,
    };

    expect(sample.source).toBe("native_query");
    expect(sample.topFailingEndpoints[0]?.endpoint).toContain("checkout");
  });
});
