import { describe, expect, it } from "vitest";

import { computeEvidenceCompleteness } from "./evidence-completeness";
import type { TimelineEntryDto } from "./types";

const baseTimeline: TimelineEntryDto[] = [
  {
    id: "1",
    occurredAt: new Date().toISOString(),
    kind: "ALERT",
    title: "High latency",
    detail: "p99 breached",
    source: "signoz-webhook",
    sourceRef: null,
    sortOrder: 0,
  },
];

describe("computeEvidenceCompleteness", () => {
  it("reports low completeness when traces and logs are missing", () => {
    const result = computeEvidenceCompleteness({
      timeline: baseTimeline,
      changeEvents: [],
      investigationContext: {
        summary: "test",
        evidence: [],
        affectedServices: ["payments-svc"],
        incidentWindow: { start: "", end: "" },
        signozConfigured: true,
        alertKind: "error",
      },
      status: "ready",
    });

    expect(result.completenessPercent).toBeLessThan(100);
    expect(result.canConclude).toBe(false);
    expect(result.missingForConclusion.some((item) => item.includes("Trace or log"))).toBe(true);
    expect(result.sources.find((s) => s.id === "signoz_traces")?.status).toBe("missing");
  });

  it("can conclude when alert plus traces are present", () => {
    const timeline: TimelineEntryDto[] = [
      ...baseTimeline,
      {
        id: "2",
        occurredAt: new Date().toISOString(),
        kind: "TRACE",
        title: "Slow span",
        detail: "GET /pay",
        source: "signoz-traces",
        sourceRef: null,
        sortOrder: 1,
      },
    ];

    const result = computeEvidenceCompleteness({
      timeline,
      changeEvents: [],
      investigationContext: {
        summary: "test",
        evidence: [],
        affectedServices: ["payments-svc"],
        incidentWindow: { start: "", end: "" },
        signozConfigured: true,
        alertKind: "error",
      },
      status: "ready",
    });

    expect(result.canConclude).toBe(true);
    expect(result.sources.find((s) => s.id === "signoz_traces")?.status).toBe("collected");
  });

  it("flags github deploy as unavailable when not configured", () => {
    const result = computeEvidenceCompleteness({
      timeline: baseTimeline,
      changeEvents: [],
      status: "ready",
    });

    expect(result.sources.find((s) => s.id === "github_deploy")?.status).toBe("unavailable");
  });
});
