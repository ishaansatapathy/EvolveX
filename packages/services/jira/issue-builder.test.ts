import { describe, expect, it } from "vitest";

import type { InvestigationOsContext } from "../investigation/types";
import { buildJiraIssueDraft } from "./issue-builder";

const baseContext: InvestigationOsContext = {
  investigation: {
    id: "11111111-1111-4111-8111-111111111111",
    incidentId: "INV-TEST",
    status: "ready",
    caseStatus: "investigating",
    severity: "high",
    primaryService: "payments-svc",
    summary: "p99 latency spike",
    startedAt: "2026-07-25T08:50:00.000Z",
    completedAt: null,
  },
  timeline: [
    {
      id: "t1",
      occurredAt: "2026-07-25T08:52:00.000Z",
      kind: "DEPLOY",
      title: "Deploy payments-svc",
      detail: "main pushed",
      source: "github-webhook",
      sourceRef: null,
      sortOrder: 1,
    },
  ],
  evidence: [],
  changeEvents: [],
  runtimeSignals: [],
  dependencies: { nodes: [], edges: [] },
  llmSummary: null,
  aiConfidence: { level: "medium", rationale: "Partial evidence" },
  ebpfEnrichment: { recommended: false, collected: false, canTrigger: true },
  pipelineCache: {
    enabled: true,
    pipelineVersion: 1,
    ttlMs: 0,
    state: "none",
    hit: false,
    cachedAt: null,
    expiresAt: null,
    missReason: null,
    missReasonLabel: "Not cached",
    contentFingerprint: null,
    skipsExpensiveRecompute: false,
  },
  evidenceCompleteness: {
    completenessPercent: 70,
    canConclude: false,
    summary: "70% evidence",
    missingForConclusion: [],
    recommendedNextSteps: [],
    sources: [],
  },
  structuredEvidence: { sections: [] },
  evidenceCitations: { citations: [] },
  incidentNarrative: { summary: "Deploy preceded alert", empty: false, beats: [] },
  rootCauseHypotheses: [
    {
      id: "h1",
      title: "Deploy regression in payments-svc",
      confidence: "high",
      rationale: "Deploy 2 min before alert",
      citationRefs: ["T1"],
      kind: "primary",
    },
  ],
  blastRadius: { summary: "1 service", primaryService: "payments-svc", totalAffected: 1, impacts: [] },
  knowledgeGraph: { summary: "graph", nodes: [], edges: [] },
  crossServiceRca: { summary: "none", primaryService: "payments-svc", paths: [] },
  serviceMapCorrelation: null,
  remediationPlaybooks: {
    summary: "1 step",
    steps: [
      {
        id: "s1",
        title: "Rollback payments-svc deploy",
        priority: "immediate",
        rationale: "Recent deploy correlated",
        commands: ["kubectl rollout undo deploy/payments-svc"],
        citationRefs: ["T1"],
      },
    ],
  },
  investigationMemory: [],
  telemetryIntelligence: null,
};

describe("Jira issue builder (#48)", () => {
  it("builds summary from primary hypothesis and includes postmortem body", () => {
    const draft = buildJiraIssueDraft({
      shortId: "INV-46F90094",
      title: "High p99 latency on payments-svc",
      affectedServices: ["payments-svc"],
      createdAt: "2026-07-25T08:50:00.000Z",
      context: baseContext,
      notes: [],
      exportedAt: "2026-07-25T09:00:00.000Z",
    });

    expect(draft.summary).toContain("INV-46F90094");
    expect(draft.summary).toContain("Deploy regression");
    expect(draft.priority).toBe("High");
    expect(draft.descriptionMarkdown).toContain("Incident Postmortem");
    expect(draft.descriptionMarkdown).toContain("Suggested fix");
    expect(draft.labels).toContain("evolvex");
  });
});
