import { describe, expect, it, vi } from "vitest";

import { buildInvestigationInsights } from "./investigation-insights";

vi.mock("./client", () => ({
  executeClickHouseQuery: vi.fn(async () => null),
  queryServiceLatencySummary: vi.fn(async () => null),
  queryTopFailingEndpoints: vi.fn(async () => null),
}));

vi.mock("./postgres-materialized-views", () => ({
  buildPostgresMaterializedInvestigationInsights: vi.fn(async () => null),
  refreshPostgresMaterializedViewsFromInsights: vi.fn(async () => undefined),
}));

vi.mock("./signoz-api-insights", () => ({
  buildSignozApiInvestigationInsights: vi.fn(async () => ({
    enabled: true as const,
    serviceName: "payments-svc",
    windowMinutes: 15,
    source: "signoz_api" as const,
    materializedViewsAvailable: false,
    latencySummary: { requests: 10, errors: 2, p99Ms: 900 },
    topFailingEndpoints: [{ endpoint: "POST /checkout", errorCount: 2, p99Ms: 900 }],
    queryElapsedMs: 42,
  })),
}));

describe("buildInvestigationInsights (#4/#5 fallback chain)", () => {
  it("falls back to SigNoz API when ClickHouse is unavailable", async () => {
    const insights = await buildInvestigationInsights({
      serviceName: "payments-svc",
      windowMinutes: 15,
    });

    expect(insights?.source).toBe("signoz_api");
    expect(insights?.topFailingEndpoints[0]?.endpoint).toContain("checkout");
  });
});
