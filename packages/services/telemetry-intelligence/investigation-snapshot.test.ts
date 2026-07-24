import { describe, expect, it, vi } from "vitest";

vi.mock("./orchestrator", () => ({
  TelemetryIntelligenceOrchestrator: vi.fn().mockImplementation(() => ({
    processAlert: vi.fn(async () => ({
      version: 1,
      processedAt: new Date().toISOString(),
      intelligenceState: "elevated",
      alertEnrichment: {
        alertName: "HighP99Latency",
        serviceNames: ["payments-svc"],
        severity: "warning",
        recentDeployCount: 1,
        enrichmentNotes: ["Latency percentile alert"],
        similarAlerts: [],
      },
      serviceMapCorrelation: null,
      samplingPolicies: [
        {
          serviceName: "payments-svc",
          mode: "elevated",
          sampleRate: 0.5,
          reason: "P99 latency alert",
        },
      ],
      collectorConfigHint: "http://localhost:8000/telemetry-intelligence/collector-config",
    })),
  })),
}));

vi.mock("./vectors/telemetry-vectors", () => ({
  attachTelemetryIntelligenceSnapshot: vi.fn(async () => undefined),
}));

import { ensureTelemetryIntelligenceForInvestigation } from "./investigation-snapshot";
import type { SelectInvestigation } from "@repo/database/schema";

function investigation(overrides: Partial<SelectInvestigation> = {}): SelectInvestigation {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: null,
    organizationId: null,
    incidentId: "INV-TEST",
    externalId: "fp-1",
    title: "payments latency",
    status: "ready",
    caseStatus: "investigating",
    severity: "high",
    primaryService: "payments-svc",
    summary: "p99 spike",
    startedAt: new Date(),
    completedAt: null,
    alertName: "HighP99Latency",
    affectedServices: ["payments-svc"],
    incidentWindowStart: new Date(),
    incidentWindowEnd: new Date(),
    signozAlertPayload: {
      alert: {
        status: "firing",
        labels: { alertname: "HighP99Latency", severity: "warning" },
        annotations: { summary: "p99 above threshold" },
        startsAt: new Date().toISOString(),
      },
      payload: {
        alerts: [
          {
            status: "firing",
            labels: { alertname: "HighP99Latency", severity: "warning" },
            annotations: { summary: "p99 above threshold" },
            startsAt: new Date().toISOString(),
          },
        ],
      },
    },
    investigationContext: null,
    telemetryIntelligence: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("ensureTelemetryIntelligenceForInvestigation", () => {
  it("returns existing snapshot without reprocessing", async () => {
    const existing = {
      version: 1,
      processedAt: "2026-07-25T08:00:00.000Z",
      intelligenceState: "normal" as const,
      samplingPolicies: [],
    };

    const result = await ensureTelemetryIntelligenceForInvestigation(
      investigation({ telemetryIntelligence: existing }),
    );

    expect(result).toEqual(existing);
  });

  it("builds snapshot from stored SigNoz payload when missing", async () => {
    const result = await ensureTelemetryIntelligenceForInvestigation(investigation());
    expect(result?.intelligenceState).toBe("elevated");
    expect(result?.samplingPolicies[0]?.serviceName).toBe("payments-svc");
  });

  it("returns null when no SigNoz payload exists", async () => {
    const result = await ensureTelemetryIntelligenceForInvestigation(
      investigation({ signozAlertPayload: null }),
    );
    expect(result).toBeNull();
  });
});
