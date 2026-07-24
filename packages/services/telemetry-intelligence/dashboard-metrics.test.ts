import { describe, expect, it } from "vitest";

import type { TelemetryIntelligenceDashboard } from "./dashboard-metrics";

describe("telemetry intelligence dashboard (#55)", () => {
  it("defines expected dashboard shape", () => {
    const sample: TelemetryIntelligenceDashboard = {
      windowDays: 30,
      generatedAt: new Date().toISOString(),
      intelligenceState: "elevated",
      totals: { investigations: 12, open: 3, resolved: 8, failed: 1 },
      avgInvestigationMinutes: 42,
      resolutionRatePercent: 67,
      activeSamplingPolicies: 2,
      incidentProneServices: [
        {
          service: "payments-svc",
          incidentCount: 5,
          openCount: 1,
          lastIncidentAt: new Date().toISOString(),
        },
      ],
      topAlertCategories: [
        { alertName: "HighP99Latency", count: 4, primaryService: "payments-svc" },
      ],
      frequentRootCauseSignals: [{ signal: "payments latency", count: 3 }],
      recentInvestigations: [],
    };

    expect(sample.incidentProneServices[0]?.service).toBe("payments-svc");
    expect(sample.resolutionRatePercent).toBeGreaterThan(0);
  });
});
