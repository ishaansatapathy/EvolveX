import { describe, expect, it } from "vitest";

import { classifyKubernetesSeverity, parseKubernetesEvent } from "../kubernetes/webhook-parser";
import {
  scoreKubernetesEventMatch,
  selectKubernetesEventTargets,
} from "./kubernetes-event-correlation";
import type { SelectInvestigation } from "@repo/database/schema";

function investigation(overrides: Partial<SelectInvestigation> = {}): SelectInvestigation {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: null,
    organizationId: "22222222-2222-4222-8222-222222222222",
    incidentId: "INV-TEST",
    externalId: null,
    title: "payments latency",
    status: "ready",
    caseStatus: "investigating",
    severity: "high",
    primaryService: "payments-svc",
    summary: "p99 spike",
    startedAt: new Date("2026-07-25T08:00:00.000Z"),
    completedAt: new Date("2026-07-25T08:10:00.000Z"),
    alertName: "HighP99Latency",
    affectedServices: ["payments-svc"],
    incidentWindowStart: new Date("2026-07-25T08:50:00.000Z"),
    incidentWindowEnd: new Date("2026-07-25T09:05:00.000Z"),
    signozAlertPayload: null,
    investigationContext: null,
    telemetryIntelligence: null,
    errorMessage: null,
    createdAt: new Date("2026-07-25T08:50:00.000Z"),
    updatedAt: new Date("2026-07-25T08:55:00.000Z"),
    ...overrides,
  };
}

describe("kubernetes event correlation (#50)", () => {
  it("classifies OOM and crash loop as critical", () => {
    expect(classifyKubernetesSeverity("OOMKilled", "Container killed due to memory limit")).toBe("critical");
    expect(classifyKubernetesSeverity("BackOff", "CrashLoopBackOff")).toBe("critical");
  });

  it("scores pod incidents higher inside the incident window", () => {
    const event = parseKubernetesEvent({
      reason: "OOMKilled",
      message: "Container payments-svc exceeded memory limit",
      involvedObject: { kind: "Pod", name: "payments-svc-7d8f9c", namespace: "production" },
      lastTimestamp: "2026-07-25T08:52:00.000Z",
    });

    const match = scoreKubernetesEventMatch(investigation(), event);
    expect(match.inWindow).toBe(true);
    expect(match.score).toBeGreaterThanOrEqual(100);
    expect(event.title).toContain("K8s incident");
  });

  it("selects service-aligned investigations for critical events", () => {
    const event = parseKubernetesEvent({
      reason: "CrashLoopBackOff",
      message: "Back-off restarting failed container",
      involvedObject: { kind: "Pod", name: "payments-svc-abc123", namespace: "production" },
      lastTimestamp: "2026-07-25T10:30:00.000Z",
    });

    const targets = selectKubernetesEventTargets([investigation()], event);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0]?.matchedBy).toBe("critical_event");
  });
});
