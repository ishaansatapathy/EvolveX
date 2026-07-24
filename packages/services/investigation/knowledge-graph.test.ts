import { describe, expect, it } from "vitest";

import { buildInvestigationKnowledgeGraph } from "./knowledge-graph";

describe("buildInvestigationKnowledgeGraph", () => {
  it("links alerts, timeline, evidence, and dependencies", () => {
    const graph = buildInvestigationKnowledgeGraph({
      primaryService: "payments-svc",
      alertName: "HighP99Latency",
      timeline: [
        {
          id: "timeline-1",
          occurredAt: "2026-01-01T12:00:00.000Z",
          kind: "TRACE",
          title: "Slow span",
          detail: "GET /checkout",
          source: "signoz",
          sourceRef: null,
        },
      ],
      evidence: [
        {
          id: "evidence-1",
          type: "trace",
          description: "920ms span",
          occurredAt: "2026-01-01T12:00:00.000Z",
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
          author: "dev",
          occurredAt: "2026-01-01T11:58:00.000Z",
          metadata: {},
        },
      ],
      dependencies: {
        edges: [{ id: "dep-1", source: "checkout-api", destination: "payments-svc", healthy: true, latencyMs: 40 }],
      },
      citationRefByTimelineId: new Map([["timeline-1", "T1"]]),
      citationRefByEvidenceId: new Map([["evidence-1", "E1"]]),
    });

    expect(graph.nodes.some((node) => node.kind === "alert")).toBe(true);
    expect(graph.nodes.some((node) => node.citationRef === "T1")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "depends_on")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "correlates_with")).toBe(true);
  });
});
