import { describe, expect, it } from "vitest";

import { computeEvidenceCompleteness } from "./evidence-completeness";
import { buildRemediationPlaybooks } from "./remediation-playbooks";

describe("buildRemediationPlaybooks", () => {
  it("prioritizes rollback when deploy evidence exists", () => {
    const timeline = [
      {
        id: "t1",
        occurredAt: "2026-01-01T12:00:00.000Z",
        kind: "DEPLOY",
        title: "Deploy payments-svc",
        detail: "GitHub push",
        source: "github",
        sourceRef: null,
      },
      {
        id: "t2",
        occurredAt: "2026-01-01T12:05:00.000Z",
        kind: "ALERT",
        title: "High latency",
        detail: "p99 above threshold",
        source: "signoz",
        sourceRef: null,
      },
    ];

    const evidenceCompleteness = computeEvidenceCompleteness({
      timeline,
      changeEvents: [],
      investigationContext: { signozConfigured: true, alertKind: "latency_percentile", summary: "", evidence: [], affectedServices: ["payments-svc"], incidentWindow: { start: "", end: "" }, notes: [] },
      status: "ready",
    });

    const result = buildRemediationPlaybooks({
      primaryService: "payments-svc",
      alertKind: "latency_percentile",
      timeline,
      changeEvents: [],
      evidenceCompleteness,
      hasPinpoint: false,
      hasDeployCorrelation: true,
      ebpfRecommended: true,
      ebpfCollected: false,
      citationRefByTimelineId: new Map([
        ["t1", "T1"],
        ["t2", "T2"],
      ]),
    });

    expect(result.steps[0]?.id).toBe("rollback-deploy");
    expect(result.steps.some((step) => step.id === "collect-ebpf")).toBe(true);
  });
});
