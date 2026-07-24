import { describe, expect, it } from "vitest";

import { buildEvidenceCitationCatalog } from "./evidence-citations";
import { buildIncidentNarrative } from "./incident-narrative";
import type { TimelineEntryDto } from "./types";

const deployEntry: TimelineEntryDto = {
  id: "t-deploy",
  occurredAt: "2026-01-01T12:28:00.000Z",
  kind: "DEPLOY",
  title: "Push to ishaansatapathy/evolvex",
  detail: "SHA abc1234 · Author Ishaan",
  source: "github",
  sourceRef: null,
  sortOrder: 0,
};

const traceEntry: TimelineEntryDto = {
  id: "t-trace",
  occurredAt: "2026-01-01T12:31:00.000Z",
  kind: "TRACE",
  title: "Slow span: GET /checkout",
  detail: "Duration: 920ms",
  source: "signoz",
  sourceRef: null,
  sortOrder: 1,
};

describe("buildIncidentNarrative", () => {
  it("builds chronological beats with time deltas and citation refs", () => {
    const citations = buildEvidenceCitationCatalog({
      timeline: [deployEntry, traceEntry],
      evidence: [],
    });

    const narrative = buildIncidentNarrative({
      timeline: [traceEntry, deployEntry],
      citations,
      primaryService: "payments-svc",
    });

    expect(narrative.empty).toBe(false);
    expect(narrative.beats).toHaveLength(2);
    expect(narrative.beats[0]?.kind).toBe("DEPLOY");
    expect(narrative.beats[1]?.sentence).toContain("3 minutes later");
    expect(narrative.beats[1]?.citationRef).toBe("T2");
    expect(narrative.summary).toContain("payments-svc");
    expect(narrative.summary).toContain("deploy precedes trace degradation");
  });

  it("returns empty narrative when timeline is missing", () => {
    const narrative = buildIncidentNarrative({
      timeline: [],
      citations: { citations: [] },
    });

    expect(narrative.empty).toBe(true);
    expect(narrative.beats).toHaveLength(0);
  });
});
