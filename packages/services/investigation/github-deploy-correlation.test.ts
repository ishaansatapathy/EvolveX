import { describe, expect, it } from "vitest";

import { inferServiceNameFromRepo, parseGithubDeployEvent } from "../github/webhook-parser";
import {
  buildGithubDeployDetail,
  scoreGithubDeployMatch,
  selectGithubDeployTargets,
} from "./github-deploy-correlation";
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

describe("github deploy correlation (#49)", () => {
  it("infers service names from repo slugs", () => {
    expect(inferServiceNameFromRepo("acme/payments-service")).toBe("payments-svc");
    expect(inferServiceNameFromRepo("acme/checkout-api")).toBe("checkout-svc");
  });

  it("scores deploy matches higher inside the incident window", () => {
    const deploy = parseGithubDeployEvent({
      repository: { full_name: "acme/payments-service" },
      head_commit: {
        id: "abcdef1234567890abcdef1234567890abcdef12",
        timestamp: "2026-07-25T08:52:00.000Z",
        message: "fix db pool",
      },
    });

    const match = scoreGithubDeployMatch(investigation(), deploy);
    expect(match.inWindow).toBe(true);
    expect(match.score).toBeGreaterThanOrEqual(85);
  });

  it("selects service-aligned investigations even outside strict window", () => {
    const deploy = parseGithubDeployEvent({
      repository: { full_name: "acme/payments-service" },
      head_commit: {
        id: "abcdef1234567890abcdef1234567890abcdef12",
        timestamp: "2026-07-25T10:30:00.000Z",
        message: "rollback",
      },
    });

    const targets = selectGithubDeployTargets([investigation()], deploy);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0]?.matchedBy).toBe("service_match");
  });

  it("builds deploy detail with changed files preview", () => {
    const deploy = parseGithubDeployEvent({
      repository: { full_name: "acme/payments-service" },
      head_commit: { id: "abc123", message: "fix" },
    });

    const detail = buildGithubDeployDetail(deploy, ["src/payments/db.ts", "src/payments/handler.ts"]);
    expect(detail).toContain("Changed files:");
    expect(detail).toContain("db.ts");
  });
});
