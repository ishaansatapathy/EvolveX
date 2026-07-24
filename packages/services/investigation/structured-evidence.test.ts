import { describe, expect, it } from "vitest";

import { buildStructuredEvidence, formatStructuredEvidenceForPrompt } from "./structured-evidence";
import type { TimelineEntryDto } from "./types";

const traceEntry: TimelineEntryDto = {
  id: "t1",
  occurredAt: "2026-01-01T12:31:00.000Z",
  kind: "TRACE",
  title: "Slow span: GET /checkout",
  detail: "Service: payments-svc · Duration: 920ms · Tail latency candidate",
  source: "signoz",
  sourceRef: null,
  sortOrder: 1,
};

describe("buildStructuredEvidence", () => {
  it("groups traces with summary fields", () => {
    const result = buildStructuredEvidence({
      timeline: [traceEntry],
      changeEvents: [],
      runtimeSignals: [],
    });

    const traces = result.sections.find((section) => section.id === "traces");
    expect(traces?.empty).toBe(false);
    expect(traces?.fields.some((field) => field.label === "Max duration" && field.value === "920ms")).toBe(
      true,
    );
    expect(traces?.items[0]?.primary).toContain("GET /checkout");
  });

  it("builds deployment section from change events", () => {
    const result = buildStructuredEvidence({
      timeline: [],
      changeEvents: [
        {
          id: "c1",
          type: "commit",
          service: "payments-svc",
          author: "Ishaan",
          occurredAt: "2026-01-01T12:28:00.000Z",
          metadata: { repo: "ishaansatapathy/evolvex", sha: "abc123def456" },
        },
      ],
      runtimeSignals: [],
    });

    const deployment = result.sections.find((section) => section.id === "deployment");
    expect(deployment?.empty).toBe(false);
    expect(deployment?.fields.some((field) => field.label === "Git SHA")).toBe(true);
    expect(deployment?.fields.some((field) => field.label === "Author" && field.value === "Ishaan")).toBe(
      true,
    );
  });

  it("marks empty sections when no data exists", () => {
    const result = buildStructuredEvidence({
      timeline: [],
      changeEvents: [],
      runtimeSignals: [],
    });

    expect(result.sections.every((section) => section.empty)).toBe(true);
  });

  it("formats non-empty sections for LLM prompts", () => {
    const result = buildStructuredEvidence({
      timeline: [traceEntry],
      changeEvents: [],
      runtimeSignals: [],
    });

    const block = formatStructuredEvidenceForPrompt(result);
    expect(block).toContain("### Traces");
    expect(block).toContain("Max duration: 920ms");
  });
});
