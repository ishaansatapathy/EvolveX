import type { EvidenceCitationCatalog } from "./evidence-citations";
import type { CrossServiceRcaResult } from "./cross-service-rca";
import type { ChangeEventRowDto, TimelineEntryDto } from "./types";

export type RootCauseHypothesis = {
  id: string;
  title: string;
  confidence: "high" | "medium" | "low";
  rationale: string;
  citationRefs: string[];
  kind: "primary" | "alternative";
};

type BuildHypothesesInput = {
  timeline: TimelineEntryDto[];
  changeEvents: ChangeEventRowDto[];
  citations: EvidenceCitationCatalog;
  primaryService: string | null;
  pinpointFile?: string | null;
  pinpointConfidence?: "high" | "medium" | "low" | null;
  crossServiceRca?: CrossServiceRcaResult;
};

function refsForKinds(
  timeline: TimelineEntryDto[],
  citations: EvidenceCitationCatalog,
  kinds: string[],
  limit = 3,
) {
  const refs: string[] = [];
  for (const entry of timeline) {
    if (!kinds.includes(entry.kind)) continue;
    const ref = citations.citations.find((c) => c.timelineEntryId === entry.id)?.ref;
    if (ref && !refs.includes(ref)) refs.push(ref);
    if (refs.length >= limit) break;
  }
  return refs;
}

/** Ranked root-cause hypotheses from real evidence only (Feature #15). */
export function buildRootCauseHypotheses(input: BuildHypothesesInput): RootCauseHypothesis[] {
  const hypotheses: RootCauseHypothesis[] = [];
  const service = input.primaryService ?? "primary service";

  const deployRefs = refsForKinds(input.timeline, input.citations, ["DEPLOY", "CHANGE"]);
  const traceRefs = refsForKinds(input.timeline, input.citations, ["TRACE"]);
  const logRefs = refsForKinds(input.timeline, input.citations, ["LOG"]);
  const metricRefs = refsForKinds(input.timeline, input.citations, ["METRIC", "ALERT"]);
  const ebpfRefs = refsForKinds(input.timeline, input.citations, ["EBPF"]);

  if (input.pinpointFile) {
    hypotheses.push({
      id: "pinpoint-primary",
      title: `Code change in ${input.pinpointFile}`,
      confidence: input.pinpointConfidence ?? "medium",
      rationale: "Pinpoint correlated log stack traces or deploy diff with a specific file.",
      citationRefs: [...traceRefs, ...logRefs, ...deployRefs].slice(0, 4),
      kind: "primary",
    });
  }

  if (deployRefs.length > 0 && (traceRefs.length > 0 || metricRefs.length > 0)) {
    hypotheses.push({
      id: "deploy-regression",
      title: "Recent deploy introduced a regression",
      confidence: deployRefs.length >= 2 ? "high" : "medium",
      rationale: `Deploy/change events overlap with degraded telemetry on ${service}.`,
      citationRefs: [...deployRefs, ...traceRefs, ...metricRefs].slice(0, 4),
      kind: hypotheses.length === 0 ? "primary" : "alternative",
    });
  }

  const topUpstreamPath = input.crossServiceRca?.paths.find((path) => path.direction === "upstream_cause");
  if (topUpstreamPath && topUpstreamPath.services.length > 1) {
    const pathRefs = topUpstreamPath.hops.flatMap((hop) => hop.citationRefs).slice(0, 4);
    hypotheses.push({
      id: "cross-service-upstream",
      title: `Upstream cause via ${topUpstreamPath.services.join(" → ")}`,
      confidence: topUpstreamPath.confidence,
      rationale: topUpstreamPath.summary,
      citationRefs: pathRefs,
      kind: hypotheses.length === 0 ? "primary" : "alternative",
    });
  }

  const hasErrorLogs = input.timeline.some(
    (entry) => entry.kind === "LOG" && /timeout|error|fail/i.test(entry.detail),
  );
  if (traceRefs.length > 0 && hasErrorLogs) {
    hypotheses.push({
      id: "dependency-failure",
      title: "Downstream dependency timeout or error",
      confidence: "medium",
      rationale: "Slow or failing spans coincide with error logs in the incident window.",
      citationRefs: [...traceRefs, ...logRefs].slice(0, 4),
      kind: hypotheses.length === 0 ? "primary" : "alternative",
    });
  }

  if (ebpfRefs.length > 0) {
    hypotheses.push({
      id: "kernel-network",
      title: "Kernel or network layer contention",
      confidence: "medium",
      rationale: "eBPF/kernel signals suggest tail latency beyond application spans alone.",
      citationRefs: ebpfRefs,
      kind: hypotheses.length === 0 ? "primary" : "alternative",
    });
  }

  if (metricRefs.length > 0 && traceRefs.length === 0 && logRefs.length === 0) {
    hypotheses.push({
      id: "insufficient-runtime",
      title: "Metrics-only signal — traces/logs needed to confirm",
      confidence: "low",
      rationale: "Alert/metric degradation detected but no correlated trace or log evidence yet.",
      citationRefs: metricRefs,
      kind: hypotheses.length === 0 ? "primary" : "alternative",
    });
  }

  if (input.changeEvents.length === 0 && deployRefs.length === 0) {
    hypotheses.push({
      id: "missing-change-data",
      title: "No deploy correlation captured",
      confidence: "low",
      rationale: "GitHub or Kubernetes change events are missing — cannot rule in/out a bad release.",
      citationRefs: metricRefs.slice(0, 2),
      kind: "alternative",
    });
  }

  if (hypotheses.length === 0) {
    hypotheses.push({
      id: "inconclusive",
      title: "Insufficient evidence to rank a root cause",
      confidence: "low",
      rationale: "Collect traces, logs, and deploy events before concluding.",
      citationRefs: [],
      kind: "primary",
    });
  }

  const primary = hypotheses.find((h) => h.kind === "primary") ?? hypotheses[0]!;
  primary.kind = "primary";
  for (const item of hypotheses) {
    if (item.id !== primary.id) item.kind = "alternative";
  }

  return hypotheses.slice(0, 5);
}
