import { describe, expect, it } from "vitest";

import { formatInvestigationMemoryForPrompt } from "./investigation-memory";

describe("investigation memory (#25)", () => {
  it("formats prior resolved incidents for LLM context", () => {
    const block = formatInvestigationMemoryForPrompt([
      {
        investigationId: "11111111-1111-4111-8111-111111111111",
        shortId: "INV-1111",
        title: "payments p99 spike",
        similarityScore: 82,
        matchReasons: ["Same service: payments-svc"],
        symptoms: "Alert: HighP99Latency\nService: payments-svc",
        rootCause: "Deploy introduced slow DB query",
        fixApplied: "Rollback deploy",
        fixOutcome: "resolved",
        durationMs: 45 * 60_000,
        impactSummary: "Severity critical",
        resolvedAt: "2026-06-01T10:00:00.000Z",
        primaryService: "payments-svc",
      },
    ]);

    expect(block).toContain("Prior incident 1");
    expect(block).toContain("Rollback deploy");
    expect(block).toContain("45 min");
  });

  it("returns empty-state copy when no matches", () => {
    expect(formatInvestigationMemoryForPrompt([])).toContain("no prior resolved incidents");
  });
});
