import type { EvidenceRowDto, TimelineEntryDto } from "./types";

export type EvidenceCitation = {
  ref: string;
  timelineEntryId: string | null;
  evidenceId: string | null;
  kind: string;
  label: string;
  occurredAt: string;
};

export type EvidenceCitationCatalog = {
  citations: EvidenceCitation[];
};

const CITATION_MARKER_PATTERN = /\[(T|E)(\d+)\]/g;

export function buildEvidenceCitationCatalog(input: {
  timeline: TimelineEntryDto[];
  evidence: EvidenceRowDto[];
}): EvidenceCitationCatalog {
  const citations: EvidenceCitation[] = [];

  input.timeline.forEach((entry, index) => {
    citations.push({
      ref: `T${index + 1}`,
      timelineEntryId: entry.id,
      evidenceId: null,
      kind: entry.kind,
      label: entry.title,
      occurredAt: entry.occurredAt,
    });
  });

  input.evidence.forEach((row, index) => {
    citations.push({
      ref: `E${index + 1}`,
      timelineEntryId: row.timelineEntryId,
      evidenceId: row.id,
      kind: row.type,
      label: row.description,
      occurredAt: row.occurredAt,
    });
  });

  return { citations };
}

export function citationByRef(catalog: EvidenceCitationCatalog, ref: string): EvidenceCitation | undefined {
  return catalog.citations.find((item) => item.ref === ref);
}

export function timelineRefForEntryId(
  catalog: EvidenceCitationCatalog,
  timelineEntryId: string,
): string | undefined {
  return catalog.citations.find(
    (item) => item.ref.startsWith("T") && item.timelineEntryId === timelineEntryId,
  )?.ref;
}

export function formatTimelineBlockWithCitationRefs(
  timeline: Array<{
    id: string;
    kind: string;
    title: string;
    detail: string;
    occurredAt: string;
    source?: string | null;
  }>,
): string {
  if (timeline.length === 0) return "(no timeline entries)";

  return timeline
    .map((entry, index) => {
      const ref = `T${index + 1}`;
      const source = entry.source ? ` (${entry.source})` : "";
      return `- ${ref} [${entry.kind}] ${entry.occurredAt}${source}: ${entry.title} — ${entry.detail}`;
    })
    .join("\n");
}

export function formatEvidenceBlockWithCitationRefs(
  evidence: Array<{
    type: string;
    description: string;
    occurredAt: string;
  }>,
): string {
  if (evidence.length === 0) return "(no evidence store rows)";

  return evidence
    .map((row, index) => {
      const ref = `E${index + 1}`;
      return `- ${ref} [${row.type}] ${row.occurredAt}: ${row.description}`;
    })
    .join("\n");
}

/** Extracts unique citation refs present in markdown text. */
export function extractCitationRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(CITATION_MARKER_PATTERN)) {
    refs.add(`${match[1]}${match[2]}`);
  }
  return [...refs];
}

export function resolveCitationTimelineEntryId(
  catalog: EvidenceCitationCatalog,
  ref: string,
): string | null {
  const citation = citationByRef(catalog, ref);
  return citation?.timelineEntryId ?? null;
}
