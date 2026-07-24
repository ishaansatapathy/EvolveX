import { describe, expect, it } from "vitest";

import {
  classifyEbpfSeverity,
  classifyEbpfSignalLayer,
  parseEbpfEvent,
} from "../ebpf/webhook-parser";
import { scoreEbpfEventMatch, selectEbpfEventTargets } from "./ebpf-event-correlation";
import type { SelectInvestigation } from "@repo/database/schema";

function investigation(overrides: Partial<SelectInvestigation> = {}): SelectInvestigation {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: null,
    organizationId: "22222222-2222-4222-8222-222222222222",
    incidentId: "INV-TEST",
    externalId: null,
    title: "payments p99 latency",
    status: "ready",
    caseStatus: "investigating",
    severity: "critical",
    primaryService: "payments-svc",
    summary: "p99 spike",
    startedAt: new Date("2026-07-25T08:00:00.000Z"),
    completedAt: new Date("2026-07-25T08:10:00.000Z"),
    alertName: "HighP99Latency",
    affectedServices: ["payments-svc"],
    incidentWindowStart: new Date("2026-07-25T08:50:00.000Z"),
    incidentWindowEnd: new Date("2026-07-25T09:05:00.000Z"),
    signozAlertPayload: null,
    investigationContext: {
      summary: "p99 spike",
      evidence: [],
      affectedServices: ["payments-svc"],
      incidentWindow: { start: "2026-07-25T08:50:00.000Z", end: "2026-07-25T09:05:00.000Z" },
      signozConfigured: true,
      alertKind: "latency_percentile",
      notes: [],
    },
    telemetryIntelligence: null,
    errorMessage: null,
    createdAt: new Date("2026-07-25T08:50:00.000Z"),
    updatedAt: new Date("2026-07-25T08:55:00.000Z"),
    ...overrides,
  };
}

describe("ebpf / OBI correlation (#51)", () => {
  it("classifies OBI connect latency as network layer warning/critical", () => {
    const event = parseEbpfEvent({
      type: "connect_latency",
      service: "payments-svc",
      value: 0.82,
      unit: "s",
      source: "obi",
      metric: "obi_stat_tcp_rtt_seconds",
      message: "OBI TCP RTT elevated for payments-svc",
      timestamp: "2026-07-25T08:52:00.000Z",
    });

    expect(event.title).toContain("OBI");
    expect(event.signalLayer).toBe("network");
    expect(classifyEbpfSeverity("connect_latency", 0.82, "obi")).toBe("critical");
    expect(classifyEbpfSignalLayer("connect_latency", "obi")).toBe("network");
  });

  it("prioritizes latency percentile investigations for OBI signals", () => {
    const event = parseEbpfEvent({
      type: "connect_latency",
      service: "payments-svc",
      value: 0.42,
      source: "obi",
      timestamp: "2026-07-25T08:52:00.000Z",
    });

    const match = scoreEbpfEventMatch(investigation(), event);
    expect(match.score).toBeGreaterThanOrEqual(100);

    const targets = selectEbpfEventTargets([investigation()], event);
    expect(targets[0]?.matchedBy).toBe("service_match");
  });
});
