import type {
  ChangeEventRowDto,
  RuntimeSignalRowDto,
  TimelineEntryDto,
} from "./types";

export type StructuredEvidenceField = {
  label: string;
  value: string;
};

export type StructuredEvidenceItem = {
  primary: string;
  secondary?: string;
  occurredAt: string;
  timelineEntryId?: string;
};

export type StructuredEvidenceSection = {
  id: "deployment" | "traces" | "logs" | "metrics" | "infrastructure";
  title: string;
  empty: boolean;
  fields: StructuredEvidenceField[];
  items: StructuredEvidenceItem[];
};

export type StructuredEvidenceResult = {
  sections: StructuredEvidenceSection[];
};

function parseDetailField(detail: string, key: string) {
  const match = detail.match(new RegExp(`${key}:\\s*([^·]+)`, "i"));
  return match?.[1]?.trim() ?? null;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

function formatChangePrimary(event: ChangeEventRowDto) {
  const sha = typeof event.metadata.sha === "string" ? event.metadata.sha.slice(0, 7) : null;
  const repo = typeof event.metadata.repo === "string" ? event.metadata.repo : null;
  if (repo && sha) return `${repo}@${sha}`;
  if (event.type === "kubernetes") {
    const kind = typeof event.metadata.kind === "string" ? event.metadata.kind : "Event";
    const name = typeof event.metadata.name === "string" ? event.metadata.name : event.service ?? "cluster";
    return `${kind} ${name}`;
  }
  return event.type;
}

function buildDeploymentSection(
  timeline: TimelineEntryDto[],
  changeEvents: ChangeEventRowDto[],
): StructuredEvidenceSection {
  const deployTimeline = timeline.filter((entry) => entry.kind.toUpperCase() === "DEPLOY");
  const deployChanges = changeEvents.filter(
    (event) => event.type === "commit" || event.type === "deployment",
  );
  const latestChange = deployChanges.at(-1) ?? null;
  const latestTimeline = deployTimeline.at(-1) ?? null;

  const sha =
    (typeof latestChange?.metadata.sha === "string" ? latestChange.metadata.sha : null) ??
    parseDetailField(latestTimeline?.detail ?? "", "SHA") ??
    parseDetailField(latestTimeline?.detail ?? "", "Commit");

  const repo = typeof latestChange?.metadata.repo === "string" ? latestChange.metadata.repo : null;
  const author = latestChange?.author ?? parseDetailField(latestTimeline?.detail ?? "", "Author");
  const occurredAt = latestChange?.occurredAt ?? latestTimeline?.occurredAt ?? null;

  const fields: StructuredEvidenceField[] = [];
  if (sha) fields.push({ label: "Git SHA", value: sha.slice(0, 12) });
  if (repo) fields.push({ label: "Repository", value: repo });
  if (author) fields.push({ label: "Author", value: author });
  if (occurredAt) fields.push({ label: "Time", value: formatTime(occurredAt) });

  const items: StructuredEvidenceItem[] = deployChanges.map((event) => ({
    primary: formatChangePrimary(event),
    secondary: event.author ?? undefined,
    occurredAt: event.occurredAt,
  }));

  for (const entry of deployTimeline) {
    items.push({
      primary: entry.title,
      secondary: entry.detail,
      occurredAt: entry.occurredAt,
      timelineEntryId: entry.id,
    });
  }

  return {
    id: "deployment",
    title: "Deployment",
    empty: fields.length === 0 && items.length === 0,
    fields,
    items: items.slice(0, 5),
  };
}

function buildTracesSection(timeline: TimelineEntryDto[]): StructuredEvidenceSection {
  const traces = timeline.filter((entry) => entry.kind.toUpperCase() === "TRACE");
  const durations = traces
    .map((entry) => {
      const ms = parseDetailField(entry.detail, "Duration");
      return ms ? Number.parseInt(ms.replace(/ms/i, ""), 10) : null;
    })
    .filter((value): value is number => value != null && !Number.isNaN(value));

  const p99 = durations.length > 0 ? Math.max(...durations) : null;
  const top = traces[0];

  const fields: StructuredEvidenceField[] = [];
  if (top) {
    fields.push({
      label: "Top span",
      value: top.title.replace(/^Slow span:\s*/i, "").replace(/^Error span:\s*/i, "") || top.title,
    });
  }
  if (p99 != null) fields.push({ label: "Max duration", value: `${p99}ms` });
  fields.push({ label: "Trace entries", value: String(traces.length) });

  const items = traces.slice(0, 5).map((entry) => ({
    primary: entry.title,
    secondary: parseDetailField(entry.detail, "Duration") ?? entry.detail.slice(0, 120),
    occurredAt: entry.occurredAt,
    timelineEntryId: entry.id,
  }));

  return {
    id: "traces",
    title: "Traces",
    empty: traces.length === 0,
    fields,
    items,
  };
}

function buildLogsSection(timeline: TimelineEntryDto[]): StructuredEvidenceSection {
  const logs = timeline.filter((entry) => entry.kind.toUpperCase() === "LOG");
  const counts = new Map<string, number>();
  for (const log of logs) {
    const key = log.title || "Log";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let topError = "";
  let topCount = 0;
  for (const [title, count] of counts) {
    if (count > topCount) {
      topCount = count;
      topError = title;
    }
  }

  const first = logs[0];

  const fields: StructuredEvidenceField[] = [];
  if (topError) fields.push({ label: "Top error type", value: topError });
  if (topCount > 0) fields.push({ label: "Count", value: String(topCount) });
  if (first) fields.push({ label: "First occurrence", value: formatTime(first.occurredAt) });

  const items = logs.slice(0, 5).map((entry) => ({
    primary: entry.title,
    secondary: entry.detail.slice(0, 140),
    occurredAt: entry.occurredAt,
    timelineEntryId: entry.id,
  }));

  return {
    id: "logs",
    title: "Logs",
    empty: logs.length === 0,
    fields,
    items,
  };
}

function buildMetricsSection(
  timeline: TimelineEntryDto[],
  runtimeSignals: RuntimeSignalRowDto[],
): StructuredEvidenceSection {
  const metrics = timeline.filter((entry) => entry.kind.toUpperCase() === "METRIC");
  const latencySignals = runtimeSignals.filter((signal) => signal.latencyMs != null || signal.p99Ms != null);

  const p99Values = latencySignals
    .map((signal) => signal.p99Ms ?? signal.latencyMs)
    .filter((value): value is number => value != null);
  const maxP99 = p99Values.length > 0 ? Math.max(...p99Values) : null;

  const fields: StructuredEvidenceField[] = [];
  if (maxP99 != null) fields.push({ label: "Peak latency", value: `${maxP99}ms` });
  fields.push({ label: "Metric entries", value: String(metrics.length) });
  fields.push({ label: "Runtime signals", value: String(runtimeSignals.length) });

  const items = [
    ...metrics.slice(0, 3).map((entry) => ({
      primary: entry.title,
      secondary: entry.detail.slice(0, 120),
      occurredAt: entry.occurredAt,
      timelineEntryId: entry.id,
    })),
    ...latencySignals.slice(0, 3).map((signal) => ({
      primary: signal.metric ?? "runtime",
      secondary: [
        signal.service,
        signal.latencyMs != null ? `${signal.latencyMs}ms` : null,
        signal.p99Ms != null ? `p99 ${signal.p99Ms}ms` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      occurredAt: signal.signalTimestamp,
    })),
  ].slice(0, 5);

  return {
    id: "metrics",
    title: "Metrics",
    empty: metrics.length === 0 && runtimeSignals.length === 0,
    fields: metrics.length === 0 && runtimeSignals.length === 0 ? [] : fields,
    items,
  };
}

function buildInfrastructureSection(
  timeline: TimelineEntryDto[],
  changeEvents: ChangeEventRowDto[],
): StructuredEvidenceSection {
  const ebpf = timeline.filter((entry) => entry.kind.toUpperCase() === "EBPF");
  const k8sTimeline = timeline.filter(
    (entry) =>
      entry.kind.toUpperCase() === "CHANGE" &&
      (entry.source?.includes("kubernetes") || entry.title.toLowerCase().includes("pod")),
  );
  const k8sChanges = changeEvents.filter((event) => event.type === "kubernetes");

  const fields: StructuredEvidenceField[] = [];
  if (k8sChanges.length > 0) fields.push({ label: "K8s events", value: String(k8sChanges.length) });
  if (ebpf.length > 0) fields.push({ label: "eBPF signals", value: String(ebpf.length) });

  const latestK8s = k8sChanges.at(-1);
  if (latestK8s) {
    const reason =
      typeof latestK8s.metadata.reason === "string"
        ? latestK8s.metadata.reason
        : typeof latestK8s.metadata.message === "string"
          ? latestK8s.metadata.message.slice(0, 80)
          : latestK8s.type;
    fields.push({ label: "Latest cluster event", value: reason });
  }

  const items = [
    ...k8sTimeline.slice(0, 3).map((entry) => ({
      primary: entry.title,
      secondary: entry.detail.slice(0, 120),
      occurredAt: entry.occurredAt,
      timelineEntryId: entry.id,
    })),
    ...k8sChanges.slice(0, 3).map((event) => ({
      primary: formatChangePrimary(event),
      secondary:
        typeof event.metadata.message === "string" ? event.metadata.message.slice(0, 120) : event.type,
      occurredAt: event.occurredAt,
    })),
    ...ebpf.slice(0, 3).map((entry) => ({
      primary: entry.title,
      secondary: entry.detail.slice(0, 120),
      occurredAt: entry.occurredAt,
      timelineEntryId: entry.id,
    })),
  ].slice(0, 5);

  return {
    id: "infrastructure",
    title: "Infrastructure",
    empty: items.length === 0,
    fields,
    items,
  };
}

/** Groups real investigation evidence into structured SRE-readable sections. */
export function buildStructuredEvidence(input: {
  timeline: TimelineEntryDto[];
  changeEvents: ChangeEventRowDto[];
  runtimeSignals: RuntimeSignalRowDto[];
}): StructuredEvidenceResult {
  return {
    sections: [
      buildDeploymentSection(input.timeline, input.changeEvents),
      buildTracesSection(input.timeline),
      buildLogsSection(input.timeline),
      buildMetricsSection(input.timeline, input.runtimeSignals),
      buildInfrastructureSection(input.timeline, input.changeEvents),
    ],
  };
}

/** Compact text block for LLM prompts — only non-empty sections. */
export function formatStructuredEvidenceForPrompt(result: StructuredEvidenceResult): string {
  const lines: string[] = [];

  for (const section of result.sections) {
    if (section.empty) continue;

    lines.push(`### ${section.title}`);
    if (section.fields.length > 0) {
      for (const field of section.fields) {
        lines.push(`- ${field.label}: ${field.value}`);
      }
    }
    for (const item of section.items.slice(0, 3)) {
      const detail = item.secondary ? ` — ${item.secondary}` : "";
      lines.push(`- ${item.primary}${detail} (${item.occurredAt})`);
    }
    lines.push("");
  }

  return lines.length > 0 ? lines.join("\n").trim() : "(no structured evidence sections)";
}
