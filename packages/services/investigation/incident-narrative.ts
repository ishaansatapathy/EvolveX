import type { EvidenceCitationCatalog } from "./evidence-citations";
import type { TimelineEntryDto } from "./types";

export type IncidentNarrativeBeat = {
  occurredAt: string;
  citationRef: string | null;
  timelineEntryId: string;
  kind: string;
  sentence: string;
};

export type IncidentNarrative = {
  summary: string;
  beats: IncidentNarrativeBeat[];
  empty: boolean;
};

function formatClockUtc(iso: string) {
  try {
    return `${new Date(iso).toISOString().slice(11, 19)} UTC`;
  } catch {
    return iso;
  }
}

function minutesBetween(previousIso: string, currentIso: string) {
  const deltaMs = new Date(currentIso).getTime() - new Date(previousIso).getTime();
  if (Number.isNaN(deltaMs) || deltaMs < 60_000) return null;
  const minutes = Math.round(deltaMs / 60_000);
  return minutes === 1 ? "1 minute later" : `${minutes} minutes later`;
}

function timelineCitationRef(catalog: EvidenceCitationCatalog, timelineEntryId: string) {
  return (
    catalog.citations.find(
      (citation) => citation.ref.startsWith("T") && citation.timelineEntryId === timelineEntryId,
    )?.ref ?? null
  );
}

function shortenDetail(detail: string, max = 120) {
  const trimmed = detail.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function beatSentence(entry: TimelineEntryDto, deltaPrefix: string | null) {
  const title = entry.title.trim();
  const detail = shortenDetail(entry.detail);
  const prefix = deltaPrefix ? `${deltaPrefix}, ` : `At ${formatClockUtc(entry.occurredAt)}, `;
  const kind = entry.kind.toUpperCase();

  switch (kind) {
    case "ALERT":
      return `${prefix}SigNoz alert fired — ${title}${detail ? ` (${detail})` : ""}.`;
    case "DEPLOY":
      return `${prefix}a deployment was recorded — ${title}${detail ? ` · ${detail}` : ""}.`;
    case "TRACE":
      return `${prefix}trace evidence appeared — ${title.replace(/^(Slow|Error) span:\s*/i, "")}${detail ? ` · ${detail}` : ""}.`;
    case "LOG":
      return `${prefix}error logs spiked — ${title}${detail ? ` · ${shortenDetail(detail, 80)}` : ""}.`;
    case "METRIC":
      return `${prefix}metrics shifted — ${title}${detail ? ` · ${detail}` : ""}.`;
    case "CHANGE":
      return `${prefix}infrastructure changed — ${title}${detail ? ` · ${detail}` : ""}.`;
    case "EBPF":
      return `${prefix}kernel/network signal detected — ${title}${detail ? ` · ${detail}` : ""}.`;
    case "AI":
      return `${prefix}AI analysis was added to the case — ${title}.`;
    default:
      return `${prefix}${kind.toLowerCase()} event — ${title}${detail ? ` · ${detail}` : ""}.`;
  }
}

/** Chronological incident story from real timeline entries — no LLM, no fabrication. */
export function buildIncidentNarrative(input: {
  timeline: TimelineEntryDto[];
  citations: EvidenceCitationCatalog;
  primaryService?: string | null;
}): IncidentNarrative {
  const sorted = [...input.timeline].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );

  if (sorted.length === 0) {
    return {
      summary: "No timeline evidence yet — narrative will appear as SigNoz, GitHub, and cluster events are collected.",
      beats: [],
      empty: true,
    };
  }

  const beats: IncidentNarrativeBeat[] = [];
  let previousIso: string | null = null;

  for (const entry of sorted) {
    const deltaPrefix = previousIso ? minutesBetween(previousIso, entry.occurredAt) : null;
    beats.push({
      occurredAt: entry.occurredAt,
      citationRef: timelineCitationRef(input.citations, entry.id),
      timelineEntryId: entry.id,
      kind: entry.kind,
      sentence: beatSentence(entry, deltaPrefix),
    });
    previousIso = entry.occurredAt;
  }

  const service = input.primaryService ?? "the affected service";
  const first = beats[0]!;
  const last = beats.at(-1)!;
  const alertBeat = beats.find((beat) => beat.kind.toUpperCase() === "ALERT");
  const deployBeat = beats.find((beat) => beat.kind.toUpperCase() === "DEPLOY");
  const traceBeat = beats.find((beat) => beat.kind.toUpperCase() === "TRACE");

  const summaryParts = [
    `This case for ${service} spans ${beats.length} timeline event${beats.length === 1 ? "" : "s"}.`,
    alertBeat
      ? `It opened when ${alertBeat.sentence.charAt(0).toLowerCase()}${alertBeat.sentence.slice(1)}`
      : `It begins at ${formatClockUtc(first.occurredAt)} with ${first.sentence.charAt(0).toLowerCase()}${first.sentence.slice(1)}`,
    deployBeat && traceBeat
      ? "A deploy precedes trace degradation in the collected evidence — review correlation before concluding root cause."
      : deployBeat
        ? "A deploy event is present in the timeline — check whether runtime symptoms followed the release."
        : traceBeat
          ? "Runtime trace evidence is present — inspect tail spans and correlated logs next."
          : "Collect additional traces, logs, or deploy events if the story still feels incomplete.",
    `Latest evidence at ${formatClockUtc(last.occurredAt)}: ${last.sentence.charAt(0).toLowerCase()}${last.sentence.slice(1)}`,
  ];

  return {
    summary: summaryParts.join(" "),
    beats,
    empty: false,
  };
}

export function formatIncidentNarrativeForPrompt(narrative: IncidentNarrative): string {
  if (narrative.empty) return "(no incident narrative yet)";
  return [narrative.summary, "", ...narrative.beats.map((beat) => `- ${beat.sentence}`)].join("\n");
}
