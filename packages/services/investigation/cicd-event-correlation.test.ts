import { describe, expect, it } from "vitest";

import { classifyCicdSeverity, parseCicdEvent } from "../cicd/webhook-parser";
import { scoreCicdEventMatch, selectCicdEventTargets } from "./cicd-event-correlation";
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

describe("CI/CD event correlation (#53)", () => {
  it("parses GitHub Actions workflow job failures", () => {
    const event = parseCicdEvent({
      action: "completed",
      workflow_job: {
        name: "integration-tests",
        conclusion: "failure",
        status: "completed",
        workflow_name: "payments-ci",
        completed_at: "2026-07-25T08:51:00.000Z",
        run_attempt: 2,
      },
      repository: { full_name: "acme/payments-svc" },
    });

    expect(event.provider).toBe("github_actions");
    expect(event.stage).toBe("test");
    expect(event.status).toBe("failure");
    expect(event.service).toBe("payments-svc");
    expect(classifyCicdSeverity(event.stage, event.status)).toBe("critical");
    expect(event.title).toContain("CI/CD");
  });

  it("scores failed tests inside the incident window highly", () => {
    const event = parseCicdEvent({
      stage: "test",
      status: "failure",
      repository: "acme/payments-svc",
      service: "payments-svc",
      occurredAt: "2026-07-25T08:52:00.000Z",
    });

    const match = scoreCicdEventMatch(investigation(), event);
    expect(match.inWindow).toBe(true);
    expect(match.score).toBeGreaterThanOrEqual(100);
  });

  it("selects pipeline failures for service-aligned investigations", () => {
    const event = parseCicdEvent({
      stage: "deploy",
      status: "failure",
      repository: "acme/payments-svc",
      service: "payments-svc",
      occurredAt: "2026-07-25T08:53:00.000Z",
    });

    const targets = selectCicdEventTargets([investigation()], event);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0]?.matchedBy).toBe("deploy_stage");
    expect(event.timelineKind).toBe("DEPLOY");
  });
});
