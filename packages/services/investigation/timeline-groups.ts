export type TimelineGroupKind =
  | "delivery_chain"
  | "log_cluster"
  | "telemetry_signals"
  | "alert_group"
  | "infrastructure"
  | "single";

export type TimelineGroupEntry = {
  id: string;
  occurredAt: string;
  kind: string;
  title: string;
  detail: string;
  source?: string | null;
};

export type TimelineGroup = {
  id: string;
  kind: TimelineGroupKind;
  title: string;
  summary: string;
  startedAt: string;
  endedAt: string;
  entryCount: number;
  highlighted: boolean;
  entries: TimelineGroupEntry[];
};

const DELIVERY_SOURCES = /cicd|github|kubernetes|feature-flag|deploy/i;
const ERROR_PATTERN = /fail|error|oom|crash|timeout|critical|backoff|killed/i;

const GROUP_WINDOW_MS: Record<TimelineGroupKind, number> = {
  delivery_chain: 25 * 60 * 1000,
  log_cluster: 12 * 60 * 1000,
  telemetry_signals: 10 * 60 * 1000,
  alert_group: 8 * 60 * 1000,
  infrastructure: 15 * 60 * 1000,
  single: 0,
};

function isDeliveryEntry(entry: TimelineGroupEntry) {
  if (entry.kind === "DEPLOY") return true;
  if (entry.kind !== "CHANGE") return false;
  return DELIVERY_SOURCES.test(entry.source ?? "") || DELIVERY_SOURCES.test(entry.title);
}

function isInfrastructureEntry(entry: TimelineGroupEntry) {
  return entry.kind === "EBPF" || /kubernetes|cicd|feature-flag|ebpf|obi/i.test(entry.source ?? "");
}

function isTelemetryEntry(entry: TimelineGroupEntry) {
  return entry.kind === "METRIC" || entry.kind === "TRACE";
}

function isLogEntry(entry: TimelineGroupEntry) {
  return entry.kind === "LOG";
}

function isAlertEntry(entry: TimelineGroupEntry) {
  return entry.kind === "ALERT";
}

function entryHighlighted(entry: TimelineGroupEntry) {
  return ERROR_PATTERN.test(`${entry.title} ${entry.detail}`);
}

function classifyEntry(entry: TimelineGroupEntry): TimelineGroupKind {
  if (isDeliveryEntry(entry)) return "delivery_chain";
  if (isAlertEntry(entry)) return "alert_group";
  if (isLogEntry(entry)) return "log_cluster";
  if (isTelemetryEntry(entry)) return "telemetry_signals";
  if (isInfrastructureEntry(entry)) return "infrastructure";
  return "single";
}

function groupTitle(kind: TimelineGroupKind, entries: TimelineGroupEntry[]) {
  switch (kind) {
    case "delivery_chain":
      return entries.length > 1 ? "Delivery chain" : "Deployment / change";
    case "log_cluster":
      return entries.length > 1 ? "Log cluster" : "Log signal";
    case "telemetry_signals":
      return entries.length > 1 ? "Telemetry burst" : "Telemetry signal";
    case "alert_group":
      return entries.length > 1 ? "Alert sequence" : "Alert fired";
    case "infrastructure":
      return entries.length > 1 ? "Infrastructure signals" : "Infrastructure signal";
    default:
      return entries[0]?.title ?? "Timeline event";
  }
}

function groupSummary(kind: TimelineGroupKind, entries: TimelineGroupEntry[]) {
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (!first || !last) return "";

  if (kind === "delivery_chain") {
    const stages = entries.map((entry) => {
      const metadata = entry.title.replace(/^CI\/CD[^·]*·?\s*/i, "").trim();
      return metadata || entry.kind;
    });
    return stages.slice(0, 4).join(" → ");
  }

  if (kind === "log_cluster") {
    const errors = entries.filter(entryHighlighted).length;
    return errors > 0
      ? `${entries.length} log entries · ${errors} error-like`
      : `${entries.length} correlated log entries`;
  }

  if (kind === "telemetry_signals") {
    const traces = entries.filter((entry) => entry.kind === "TRACE").length;
    const metrics = entries.filter((entry) => entry.kind === "METRIC").length;
    return `${traces} trace(s) · ${metrics} metric(s)`;
  }

  if (kind === "alert_group") {
    return entries.map((entry) => entry.title).slice(0, 3).join(" · ");
  }

  return first.detail || first.title;
}

function buildGroup(kind: TimelineGroupKind, entries: TimelineGroupEntry[], index: number): TimelineGroup {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );
  const startedAt = sorted[0]!.occurredAt;
  const endedAt = sorted[sorted.length - 1]!.occurredAt;

  return {
    id: `${kind}-${index}-${sorted[0]!.id}`,
    kind,
    title: groupTitle(kind, sorted),
    summary: groupSummary(kind, sorted),
    startedAt,
    endedAt,
    entryCount: sorted.length,
    highlighted: sorted.some(entryHighlighted),
    entries: sorted,
  };
}

/** Feature #54 — group related timeline entries into expandable sections. */
export function groupTimelineEntries(entries: TimelineGroupEntry[]): TimelineGroup[] {
  if (entries.length === 0) return [];

  const sorted = [...entries].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );

  const groups: TimelineGroup[] = [];
  let bucketKind: TimelineGroupKind | null = null;
  let bucket: TimelineGroupEntry[] = [];
  let bucketAnchorMs = 0;
  let groupIndex = 0;

  function flush() {
    if (bucket.length === 0) return;
    groups.push(buildGroup(bucketKind ?? "single", bucket, groupIndex++));
    bucket = [];
    bucketKind = null;
    bucketAnchorMs = 0;
  }

  for (const entry of sorted) {
    const kind = classifyEntry(entry);
    const entryMs = new Date(entry.occurredAt).getTime();

    if (kind === "single") {
      flush();
      groups.push(buildGroup("single", [entry], groupIndex++));
      continue;
    }

    const windowMs = GROUP_WINDOW_MS[kind];
    const sameBucket = bucketKind === kind;
    const inWindow = sameBucket && entryMs - bucketAnchorMs <= windowMs;

    if (!sameBucket || !inWindow) {
      flush();
      bucketKind = kind;
      bucket = [entry];
      bucketAnchorMs = entryMs;
      continue;
    }

    bucket.push(entry);
  }

  flush();
  return groups.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
}

export function flattenTimelineGroups(groups: TimelineGroup[]): TimelineGroupEntry[] {
  return groups.flatMap((group) => group.entries);
}
