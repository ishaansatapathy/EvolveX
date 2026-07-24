import { describe, expect, it } from "vitest";

import {
  buildEvidenceCitationCatalog,
  extractCitationRefs,
  formatEvidenceBlockWithCitationRefs,
  formatTimelineBlockWithCitationRefs,
  resolveCitationTimelineEntryId,
} from "./evidence-citations";
import type { EvidenceRowDto, TimelineEntryDto } from "./types";

const timelineEntry: TimelineEntryDto = {
  id: "timeline-1",
  occurredAt: "2026-01-01T12:31:00.000Z",
  kind: "TRACE",
  title: "Slow span: GET /checkout",
  detail: "Duration: 920ms",
  source: "signoz",
  sourceRef: null,
  sortOrder: 1,
};

const evidenceRow: EvidenceRowDto = {
  id: "evidence-1",
  type: "log",
  description: "Redis connection timeout",
  occurredAt: "2026-01-01T12:30:00.000Z",
  url: null,
  confidence: "high",
  timelineEntryId: "timeline-1",
  metadata: {},
};

describe("buildEvidenceCitationCatalog", () => {
  it("assigns T and E refs with timeline links", () => {
    const catalog = buildEvidenceCitationCatalog({
      timeline: [timelineEntry],
      evidence: [evidenceRow],
    });

    expect(catalog.citations).toHaveLength(2);
    expect(catalog.citations[0]?.ref).toBe("T1");
    expect(catalog.citations[0]?.timelineEntryId).toBe("timeline-1");
    expect(catalog.citations[1]?.ref).toBe("E1");
    expect(catalog.citations[1]?.timelineEntryId).toBe("timeline-1");
  });

  it("formats timeline and evidence blocks with refs", () => {
    const block = formatTimelineBlockWithCitationRefs([
      {
        id: timelineEntry.id,
        kind: timelineEntry.kind,
        title: timelineEntry.title,
        detail: timelineEntry.detail,
        occurredAt: timelineEntry.occurredAt,
        source: timelineEntry.source,
      },
    ]);

    expect(block).toContain("T1 [TRACE]");
    expect(
      formatEvidenceBlockWithCitationRefs([
        {
          type: evidenceRow.type,
          description: evidenceRow.description,
          occurredAt: evidenceRow.occurredAt,
        },
      ]),
    ).toContain("E1 [log]");
  });

  it("extracts and resolves citation refs from markdown", () => {
    const catalog = buildEvidenceCitationCatalog({
      timeline: [timelineEntry],
      evidence: [evidenceRow],
    });

    const markdown = "Likely cause: slow checkout path [T1] backed by log [E1].";
    expect(extractCitationRefs(markdown)).toEqual(["T1", "E1"]);
    expect(resolveCitationTimelineEntryId(catalog, "T1")).toBe("timeline-1");
    expect(resolveCitationTimelineEntryId(catalog, "E1")).toBe("timeline-1");
  });
});
