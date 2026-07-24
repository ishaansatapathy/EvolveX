import { describe, expect, it } from "vitest";

import { buildRootCauseHypotheses } from "./root-cause-hypotheses";

describe("buildRootCauseHypotheses", () => {
  it("ranks deploy + trace evidence as primary regression hypothesis", () => {
    const timeline = [
      {
        id: "t1",
        occurredAt: "2026-01-01T12:00:00.000Z",
        kind: "DEPLOY",
        title: "Deploy payments-svc",
        detail: "GitHub push",
        source: "github",
        sourceRef: null,
        sortOrder: 1,
      },
      {
        id: "t2",
        occurredAt: "2026-01-01T12:05:00.000Z",
        kind: "TRACE",
        title: "Slow span",
        detail: "920ms",
        source: "signoz",
        sourceRef: null,
        sortOrder: 2,
      },
    ];

    const hypotheses = buildRootCauseHypotheses({
      timeline,
      changeEvents: [],
      citations: {
        citations: [
          { ref: "T1", timelineEntryId: "t1", evidenceId: null, kind: "DEPLOY", label: "Deploy", occurredAt: timeline[0]!.occurredAt },
          { ref: "T2", timelineEntryId: "t2", evidenceId: null, kind: "TRACE", label: "Trace", occurredAt: timeline[1]!.occurredAt },
        ],
      },
      primaryService: "payments-svc",
    });

    expect(hypotheses[0]?.id).toBe("deploy-regression");
    expect(hypotheses[0]?.kind).toBe("primary");
    expect(hypotheses[0]?.citationRefs).toContain("T1");
  });
});
