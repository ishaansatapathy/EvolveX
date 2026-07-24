import { describe, expect, it } from "vitest";

import {
  classifyFeatureFlagSeverity,
  parseFeatureFlagEvent,
} from "../feature-flags/webhook-parser";
import {
  scoreFeatureFlagMatch,
  selectFeatureFlagTargets,
} from "./feature-flag-correlation";
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

describe("feature flag correlation (#52)", () => {
  it("parses LaunchDarkly flag enable events", () => {
    const event = parseFeatureFlagEvent({
      kind: "flag",
      action: "update",
      title: "Turned on flag New Checkout",
      target: { key: "new-checkout", name: "New Checkout", tags: ["service:payments-svc"] },
      member: { email: "alex@example.com" },
      date: "2026-07-25T08:52:00.000Z",
    });

    expect(event.provider).toBe("launchdarkly");
    expect(event.flagKey).toBe("new-checkout");
    expect(event.action).toBe("enabled");
    expect(event.service).toBe("payments-svc");
    expect(classifyFeatureFlagSeverity(event.action)).toBe("critical");
    expect(event.title).toContain("Feature flag");
  });

  it("scores enabled flags inside the incident window", () => {
    const event = parseFeatureFlagEvent({
      provider: "flagsmith",
      event_type: "FLAG_UPDATED",
      data: {
        flag_name: "new-checkout",
        environment_name: "production",
        new_state: "ENABLED",
        service: "payments-svc",
      },
      timestamp: "2026-07-25T08:52:00.000Z",
    });

    const match = scoreFeatureFlagMatch(investigation(), event);
    expect(match.inWindow).toBe(true);
    expect(match.score).toBeGreaterThanOrEqual(100);
  });

  it("selects service-aligned investigations for flag rollouts", () => {
    const event = parseFeatureFlagEvent({
      flagKey: "checkout-v2-rollout",
      action: "rollout",
      service: "payments-svc",
      occurredAt: "2026-07-25T10:30:00.000Z",
    });

    const targets = selectFeatureFlagTargets([investigation()], event);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0]?.matchedBy).toBe("service_match");
  });
});
