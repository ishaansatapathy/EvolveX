import { describe, expect, it } from "vitest";

import { buildPostmortemFilename, buildPostmortemMarkdown } from "./postmortem-export";
import type { InvestigationOsContext } from "./types";

const baseContext: InvestigationOsContext = {
  investigation: {
    id: "11111111-1111-1111-1111-111111111111",
    incidentId: "EVX-001",
    status: "ready",
    caseStatus: "open",
    severity: "high",
    primaryService: "payments-svc",
    summary: "Tail latency spike correlated with deploy.",
    startedAt: "2026-01-01T12:25:00.000Z",
    completedAt: "2026-01-01T12:40:00.000Z",
  },
  timeline: [
    {
      id: "timeline-1",
      occurredAt: "2026-01-01T12:31:00.000Z",
      kind: "TRACE",
      title: "Slow span: GET /checkout",
      detail: "Duration: 920ms",
      source: "signoz",
      sourceRef: null,
      sortOrder: 1,
    },
  ],
  evidence: [
    {
      id: "evidence-1",
      type: "log",
      description: "Redis connection timeout",
      occurredAt: "2026-01-01T12:30:00.000Z",
      url: null,
      confidence: "high",
      timelineEntryId: "timeline-1",
      metadata: {},
    },
  ],
  changeEvents: [
    {
      id: "change-1",
      type: "commit",
      service: "payments-svc",
      author: "Ishaan",
      occurredAt: "2026-01-01T12:28:00.000Z",
      metadata: { repo: "ishaansatapathy/evolvex", sha: "abc123def456" },
    },
  ],
  runtimeSignals: [],
  dependencies: { nodes: [], edges: [] },
  llmSummary: {
    markdown: "## Summary\nCheckout latency degraded after deploy [T1].",
    generatedAt: "2026-01-01T12:35:00.000Z",
  },
  aiConfidence: {
    level: "medium",
    rationale: "Partial evidence with AI summary.",
  },
  ebpfEnrichment: {
    recommended: true,
    collected: false,
    canTrigger: true,
  },
  evidenceCompleteness: {
    completenessPercent: 72,
    canConclude: false,
    summary: "72% evidence collected — deploy correlation present.",
    missingForConclusion: ["Kubernetes cluster events"],
    recommendedNextSteps: ["Verify K8s webhook is configured"],
    sources: [
      {
        id: "signoz_traces",
        label: "SigNoz traces",
        status: "collected",
        configured: true,
        detail: "1 trace evidence entries",
      },
    ],
  },
  structuredEvidence: {
    sections: [
      {
        id: "traces",
        title: "Traces",
        empty: false,
        fields: [{ label: "Max duration", value: "920ms" }],
        items: [{ primary: "GET /checkout", occurredAt: "2026-01-01T12:31:00.000Z", timelineEntryId: "timeline-1" }],
      },
    ],
  },
  incidentNarrative: {
    summary: "Deploy preceded trace degradation for payments-svc.",
    empty: false,
    beats: [
      {
        occurredAt: "2026-01-01T12:31:00.000Z",
        citationRef: "T1",
        timelineEntryId: "timeline-1",
        kind: "TRACE",
        sentence: "At 12:31:00 UTC, trace evidence appeared — GET /checkout · Duration: 920ms.",
      },
    ],
  },
  evidenceCitations: {
    citations: [
      {
        ref: "T1",
        timelineEntryId: "timeline-1",
        evidenceId: null,
        kind: "TRACE",
        label: "Slow span: GET /checkout",
        occurredAt: "2026-01-01T12:31:00.000Z",
      },
      {
        ref: "E1",
        timelineEntryId: "timeline-1",
        evidenceId: "evidence-1",
        kind: "log",
        label: "Redis connection timeout",
        occurredAt: "2026-01-01T12:30:00.000Z",
      },
    ],
  },
  rootCauseHypotheses: [
    {
      id: "hyp-1",
      title: "Deploy regression in payments-svc",
      confidence: "high",
      rationale: "Commit landed minutes before trace degradation.",
      citationRefs: ["T1"],
      kind: "primary",
    },
  ],
};

describe("buildPostmortemMarkdown", () => {
  it("includes metadata, timeline citations, and AI summary", () => {
    const markdown = buildPostmortemMarkdown({
      shortId: "EVX-001",
      title: "Checkout latency spike",
      affectedServices: ["payments-svc"],
      createdAt: "2026-01-01T12:25:00.000Z",
      context: baseContext,
      notes: [{ id: "note-1", body: "Looks related to Redis pool exhaustion.", createdAt: "2026-01-01T12:36:00.000Z", updatedAt: null }],
      exportedAt: "2026-01-01T13:00:00.000Z",
    });

    expect(markdown).toContain("# Incident Postmortem · EVX-001");
    expect(markdown).toContain("Checkout latency degraded after deploy [T1]");
    expect(markdown).toContain("Incident narrative");
    expect(markdown).toContain("GET /checkout");
    expect(markdown).toContain("[E1] **log**");
    expect(markdown).toContain("Looks related to Redis pool exhaustion.");
    expect(markdown).toContain("72% evidence collected");
    expect(markdown).toContain("**Case status:** open");
    expect(markdown).toContain("**AI confidence:** medium");
    expect(markdown).toContain("Deploy regression in payments-svc");
  });

  it("builds a safe filename from short id", () => {
    expect(buildPostmortemFilename("EVX-001")).toBe("evolvex-postmortem-evx-001.md");
  });
});
