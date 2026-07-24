import type { CrossServiceRcaResult } from "./cross-service-rca";
import type { EvidenceCompletenessResult } from "./evidence-completeness";
import type { ChangeEventRowDto, TimelineEntryDto } from "./types";

export type RemediationStepPriority = "immediate" | "investigate" | "mitigate";

export type RemediationPlaybookStep = {
  id: string;
  title: string;
  priority: RemediationStepPriority;
  rationale: string;
  commands: string[];
  citationRefs: string[];
};

export type RemediationPlaybookResult = {
  summary: string;
  steps: RemediationPlaybookStep[];
};

type BuildPlaybooksInput = {
  primaryService: string | null;
  alertKind?: string | null;
  timeline: TimelineEntryDto[];
  changeEvents: ChangeEventRowDto[];
  evidenceCompleteness: EvidenceCompletenessResult;
  crossServiceRca?: CrossServiceRcaResult;
  citationRefByTimelineId?: Map<string, string>;
  hasPinpoint: boolean;
  hasDeployCorrelation: boolean;
  ebpfRecommended: boolean;
  ebpfCollected: boolean;
};

function refsForTimeline(
  timeline: TimelineEntryDto[],
  citationRefByTimelineId: Map<string, string> | undefined,
  kinds: string[],
  limit = 3,
) {
  const refs: string[] = [];
  for (const entry of timeline) {
    if (!kinds.includes(entry.kind)) continue;
    const ref = citationRefByTimelineId?.get(entry.id);
    if (ref && !refs.includes(ref)) refs.push(ref);
    if (refs.length >= limit) break;
  }
  return refs;
}

/** Deterministic remediation runbook from collected evidence (Feature #24). */
export function buildRemediationPlaybooks(input: BuildPlaybooksInput): RemediationPlaybookResult {
  const service = input.primaryService ?? "primary-service";
  const steps: RemediationPlaybookStep[] = [];
  const isLatency = input.alertKind === "latency_percentile" || /latency|p99|p95|slow/i.test(input.alertKind ?? "");
  const isError = !isLatency && /error|5xx|fail|exception/i.test(input.alertKind ?? "error");

  const deployRefs = refsForTimeline(input.timeline, input.citationRefByTimelineId, ["DEPLOY", "CHANGE"]);
  const traceRefs = refsForTimeline(input.timeline, input.citationRefByTimelineId, ["TRACE"]);
  const logRefs = refsForTimeline(input.timeline, input.citationRefByTimelineId, ["LOG"]);
  const alertRefs = refsForTimeline(input.timeline, input.citationRefByTimelineId, ["ALERT", "METRIC"]);

  if (input.hasDeployCorrelation && deployRefs.length > 0) {
    steps.push({
      id: "rollback-deploy",
      title: `Rollback or revert the recent ${service} deploy`,
      priority: "immediate",
      rationale: "A deploy/change event overlaps the incident window — fastest way to restore service is often rollback first.",
      commands: [
        `# Verify latest deploy on ${service}`,
        `kubectl rollout history deployment/${service}`,
        `kubectl rollout undo deployment/${service}`,
      ],
      citationRefs: deployRefs,
    });
  }

  const topUpstream = input.crossServiceRca?.paths.find((path) => path.direction === "upstream_cause");
  if (topUpstream && topUpstream.services.length > 1) {
    const upstreamService = topUpstream.services[0]!;
    steps.push({
      id: "check-upstream",
      title: `Inspect upstream dependency ${upstreamService}`,
      priority: "investigate",
      rationale: topUpstream.summary,
      commands: [
        `# Check health and latency for upstream caller`,
        `# SigNoz: filter traces where service.name = '${upstreamService}'`,
        `# Compare error rate before/after incident window`,
      ],
      citationRefs: topUpstream.hops.flatMap((hop) => hop.citationRefs).slice(0, 3),
    });
  }

  if (isLatency) {
    steps.push({
      id: "tail-latency-triage",
      title: `Triage tail latency on ${service}`,
      priority: "investigate",
      rationale: "Latency percentile alert — focus on slow traces and dependency timeouts, not average CPU.",
      commands: [
        `# Pull slow traces (>800ms) for ${service} in incident window`,
        `# Check downstream DB/cache/external API latency`,
        `# Compare p99 vs p50 to detect tail-only regression`,
      ],
      citationRefs: [...traceRefs, ...alertRefs].slice(0, 4),
    });
  }

  if (isError || logRefs.length > 0) {
    steps.push({
      id: "error-log-triage",
      title: `Correlate error logs and failing spans on ${service}`,
      priority: "investigate",
      rationale: "Error-rate incidents need log stack traces aligned with failing trace IDs.",
      commands: [
        `# Filter ERROR logs for ${service} in incident window`,
        `# Open exemplar traces linked from logs`,
        `# Search for timeout/connection refused patterns`,
      ],
      citationRefs: [...logRefs, ...traceRefs].slice(0, 4),
    });
  }

  if (input.hasPinpoint) {
    steps.push({
      id: "review-pinpoint",
      title: "Review pinpointed file and generate a minimal patch",
      priority: "mitigate",
      rationale: "Pinpoint matched log stack traces or deploy diff to a specific file — validate before merging.",
      commands: [
        `# Use Evolvex "Suggest fix" for a draft patch`,
        `# Run targeted unit/integration tests for the pinpointed file`,
        `# Open PR with rollback plan documented`,
      ],
      citationRefs: [...traceRefs, ...logRefs, ...deployRefs].slice(0, 3),
    });
  }

  if (input.ebpfRecommended && !input.ebpfCollected) {
    steps.push({
      id: "collect-ebpf",
      title: "Collect kernel/network eBPF signals",
      priority: "investigate",
      rationale: "Tail latency may be caused by kernel or network contention invisible in application spans alone.",
      commands: [
        `# Trigger eBPF enrichment in Evolvex case view`,
        `pnpm obi:bridge   # optional OBI bridge demo`,
      ],
      citationRefs: alertRefs.slice(0, 2),
    });
  }

  for (const source of input.evidenceCompleteness.sources
    .filter((item) => item.status === "missing" || item.status === "partial")
    .slice(0, 2)) {
    steps.push({
      id: `close-gap-${source.id}`,
      title: `Close evidence gap: ${source.label}`,
      priority: "investigate",
      rationale: source.detail,
      commands:
        input.evidenceCompleteness.recommendedNextSteps.length > 0
          ? [input.evidenceCompleteness.recommendedNextSteps[0]!]
          : [`# Wire ${source.label} in Settings or .env`],
      citationRefs: [],
    });
  }

  if (steps.length === 0) {
    steps.push({
      id: "baseline-triage",
      title: `Run baseline incident triage on ${service}`,
      priority: "investigate",
      rationale: "Insufficient specialized signals yet — collect traces, logs, and deploy history before mitigating.",
      commands: [
        `pnpm investigation:refresh`,
        `# Confirm SigNoz alert webhook and GitHub token are configured`,
      ],
      citationRefs: alertRefs.slice(0, 2),
    });
  }

  const priorityOrder: Record<RemediationStepPriority, number> = {
    immediate: 0,
    investigate: 1,
    mitigate: 2,
  };

  steps.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const immediateCount = steps.filter((step) => step.priority === "immediate").length;
  const summary =
    immediateCount > 0
      ? `${steps.length} remediation steps ranked — ${immediateCount} immediate action(s) based on deploy/evidence signals.`
      : `${steps.length} remediation steps ranked from collected incident evidence.`;

  return {
    summary,
    steps: steps.slice(0, 8),
  };
}
