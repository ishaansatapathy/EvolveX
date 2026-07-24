import { isGithubApiConfigured } from "../github/api";
import { isOpenAiConfigured } from "../ai/openai";
import {
  isEbpfWebhookConfigured,
  isFeatureFlagWebhookConfigured,
  isCicdWebhookConfigured,
  isGithubWebhookConfigured,
  isKubernetesWebhookConfigured,
} from "../integrations/config";
import { isSignozConfigured } from "../signoz-env";
import type {
  ChangeEventRowDto,
  InvestigationContext,
  TimelineEntryDto,
} from "./types";

export type EvidenceSourceId =
  | "signoz_alert"
  | "signoz_traces"
  | "signoz_logs"
  | "signoz_metrics"
  | "github_deploy"
  | "kubernetes_events"
  | "feature_flags"
  | "cicd_pipeline"
  | "ebpf_signals"
  | "github_api";

export type EvidenceSourceStatus = "collected" | "missing" | "unavailable" | "partial";

export type EvidenceSourceCheck = {
  id: EvidenceSourceId;
  label: string;
  status: EvidenceSourceStatus;
  configured: boolean;
  detail: string;
};

export type EvidenceCompletenessResult = {
  /** 0–100 — share of applicable evidence sources with data collected */
  completenessPercent: number;
  canConclude: boolean;
  summary: string;
  missingForConclusion: string[];
  recommendedNextSteps: string[];
  sources: EvidenceSourceCheck[];
};

const MIN_LOG_TIMELINE = 1;
const MIN_TRACE_TIMELINE = 1;

function timelineKinds(timeline: TimelineEntryDto[]) {
  return new Set(timeline.map((entry) => entry.kind.toUpperCase()));
}

function hasDeployEvidence(timeline: TimelineEntryDto[], changeEvents: ChangeEventRowDto[]) {
  const kinds = timelineKinds(timeline);
  if (kinds.has("DEPLOY")) return true;
  return changeEvents.some((event) => event.type === "commit" || event.type === "deployment");
}

function changedFilesInDeployEvidence(timeline: TimelineEntryDto[], changeEvents: ChangeEventRowDto[]) {
  for (const entry of timeline) {
    if (entry.kind !== "DEPLOY") continue;
    const metadata = (entry.sourceRef ?? entry.metadata ?? {}) as Record<string, unknown>;
    const files = metadata.changedFiles;
    if (Array.isArray(files) && files.length > 0) return true;
  }

  return changeEvents.some((event) => {
    const files = event.metadata.changedFiles;
    return Array.isArray(files) && files.length > 0;
  });
}

function hasKubernetesEvidence(timeline: TimelineEntryDto[], changeEvents: ChangeEventRowDto[]) {
  const kinds = timelineKinds(timeline);
  if (kinds.has("CHANGE") && timeline.some((e) => e.source?.includes("kubernetes"))) return true;
  return changeEvents.some(
    (event) =>
      event.type === "kubernetes" ||
      (typeof event.metadata.kind === "string" &&
        ["Pod", "Deployment", "ReplicaSet"].includes(event.metadata.kind)),
  );
}

function hasCriticalKubernetesEvidence(timeline: TimelineEntryDto[], changeEvents: ChangeEventRowDto[]) {
  for (const entry of timeline) {
    if (!entry.source?.includes("kubernetes")) continue;
    const metadata = (entry.sourceRef ?? entry.metadata ?? {}) as Record<string, unknown>;
    if (metadata.severity === "critical") return true;
    const reason = typeof metadata.reason === "string" ? metadata.reason : entry.title;
    if (/oom|crashloop|failed|evicted|backoff/i.test(reason)) return true;
  }

  return changeEvents.some((event) => {
    if (event.type !== "kubernetes") return false;
    if (event.metadata.severity === "critical") return true;
    const reason = typeof event.metadata.reason === "string" ? event.metadata.reason : "";
    return /oom|crashloop|failed|evicted|backoff/i.test(reason);
  });
}

function hasFeatureFlagEvidence(timeline: TimelineEntryDto[], changeEvents: ChangeEventRowDto[]) {
  if (timeline.some((entry) => entry.source?.includes("feature-flag"))) return true;
  return changeEvents.some((event) => event.type === "feature_flag");
}

function hasCicdEvidence(timeline: TimelineEntryDto[], changeEvents: ChangeEventRowDto[]) {
  if (timeline.some((entry) => entry.source?.includes("cicd"))) return true;
  return changeEvents.some((event) => event.type === "cicd");
}

function hasFailedCicdEvidence(timeline: TimelineEntryDto[], changeEvents: ChangeEventRowDto[]) {
  for (const entry of timeline) {
    if (!entry.source?.includes("cicd")) continue;
    const metadata = (entry.sourceRef ?? entry.metadata ?? {}) as Record<string, unknown>;
    if (metadata.status === "failure" || metadata.status === "retried") return true;
  }
  return changeEvents.some(
    (event) =>
      event.type === "cicd" &&
      (event.metadata.status === "failure" || event.metadata.status === "retried"),
  );
}

function hasObiEbpfEvidence(timeline: TimelineEntryDto[]) {
  return timeline.some((entry) => {
    if (entry.kind !== "EBPF") return false;
    const metadata = (entry.sourceRef ?? entry.metadata ?? {}) as Record<string, unknown>;
    const source = entry.source ?? "";
    return metadata.collector === "obi" || source.includes("obi") || String(entry.title).includes("OBI");
  });
}

function countTimelineKind(timeline: TimelineEntryDto[], kind: string) {
  return timeline.filter((entry) => entry.kind.toUpperCase() === kind.toUpperCase()).length;
}

/**
 * Computes investigation evidence completeness from real collected timeline data
 * and platform integration configuration. Never fabricates collected evidence.
 */
export function computeEvidenceCompleteness(input: {
  timeline: TimelineEntryDto[];
  changeEvents: ChangeEventRowDto[];
  investigationContext?: InvestigationContext | null;
  status: "building" | "ready" | "failed";
}): EvidenceCompletenessResult {
  const { timeline, changeEvents, investigationContext, status } = input;
  const kinds = timelineKinds(timeline);
  const signozConfigured = investigationContext?.signozConfigured ?? isSignozConfigured();
  const alertKind = investigationContext?.alertKind ?? "unknown";
  const isLatencyAlert = alertKind === "latency_percentile";

  const traceCount = countTimelineKind(timeline, "TRACE");
  const logCount = countTimelineKind(timeline, "LOG");
  const metricCount = countTimelineKind(timeline, "METRIC");
  const ebpfCount = countTimelineKind(timeline, "EBPF");
  const hasAlert = kinds.has("ALERT") || timeline.length > 0;

  const sources: EvidenceSourceCheck[] = [
    {
      id: "signoz_alert",
      label: "SigNoz alert",
      configured: signozConfigured,
      status: hasAlert ? "collected" : signozConfigured ? "missing" : "unavailable",
      detail: hasAlert ? "Alert ingested into timeline" : "No alert timeline entry",
    },
    {
      id: "signoz_traces",
      label: "SigNoz traces",
      configured: signozConfigured,
      status: !signozConfigured
        ? "unavailable"
        : traceCount >= MIN_TRACE_TIMELINE
          ? "collected"
          : "missing",
      detail:
        traceCount >= MIN_TRACE_TIMELINE
          ? `${traceCount} trace evidence entries`
          : signozConfigured
            ? "No error/slow traces matched in incident window"
            : "Set SIGNOZ_CLOUD_URL + SIGNOZ_API_KEY",
    },
    {
      id: "signoz_logs",
      label: "SigNoz logs",
      configured: signozConfigured,
      status: !signozConfigured
        ? "unavailable"
        : logCount >= MIN_LOG_TIMELINE
          ? "collected"
          : "missing",
      detail:
        logCount >= MIN_LOG_TIMELINE
          ? `${logCount} log evidence entries`
          : signozConfigured
            ? "No error/warn logs matched in incident window"
            : "Set SIGNOZ_CLOUD_URL + SIGNOZ_API_KEY",
    },
    {
      id: "signoz_metrics",
      label: "SigNoz metrics",
      configured: signozConfigured,
      status: !signozConfigured
        ? "unavailable"
        : metricCount > 0
          ? "collected"
          : isLatencyAlert
            ? "missing"
            : "partial",
      detail:
        metricCount > 0
          ? `${metricCount} metric evidence entries`
          : isLatencyAlert
            ? "Percentile alert with no metric enrichment yet"
            : "Optional for non-latency alerts",
    },
    {
      id: "github_deploy",
      label: "GitHub deploy",
      configured: isGithubWebhookConfigured() || isGithubApiConfigured(),
      status: !isGithubWebhookConfigured() && !isGithubApiConfigured()
        ? "unavailable"
        : hasDeployEvidence(timeline, changeEvents)
          ? "collected"
          : "missing",
      detail: hasDeployEvidence(timeline, changeEvents)
        ? changedFilesInDeployEvidence(timeline, changeEvents)
          ? "Deploy/commit correlated with GitHub diff"
          : "Deploy/commit correlated"
        : isGithubWebhookConfigured()
          ? "Webhook configured — no push in incident window"
          : "Set GITHUB_WEBHOOK_SECRET or connect GitHub webhook",
    },
    {
      id: "github_api",
      label: "GitHub API (pinpoint)",
      configured: isGithubApiConfigured(),
      status: !isGithubApiConfigured() ? "unavailable" : "partial",
      detail: isGithubApiConfigured()
        ? "GITHUB_TOKEN set — file fetch enabled"
        : "Set GITHUB_TOKEN for pinpoint file snippets",
    },
    {
      id: "kubernetes_events",
      label: "Kubernetes events",
      configured: isKubernetesWebhookConfigured(),
      status: !isKubernetesWebhookConfigured()
        ? "unavailable"
        : hasKubernetesEvidence(timeline, changeEvents)
          ? "collected"
          : "missing",
      detail: hasKubernetesEvidence(timeline, changeEvents)
        ? hasCriticalKubernetesEvidence(timeline, changeEvents)
          ? "Critical K8s event correlated (OOM/restart/crash)"
          : "Cluster change events correlated"
        : "K8s webhook configured — no events in window",
    },
    {
      id: "feature_flags",
      label: "Feature flag changes",
      configured: isFeatureFlagWebhookConfigured(),
      status: !isFeatureFlagWebhookConfigured()
        ? "unavailable"
        : hasFeatureFlagEvidence(timeline, changeEvents)
          ? "collected"
          : "missing",
      detail: hasFeatureFlagEvidence(timeline, changeEvents)
        ? "Flag enable/rollout correlated — possible non-deploy incident trigger"
        : isFeatureFlagWebhookConfigured()
          ? "Feature flag webhook configured — no toggles in window"
          : "Set FEATURE_FLAG_WEBHOOK_SECRET for LaunchDarkly/Flagsmith events",
    },
    {
      id: "cicd_pipeline",
      label: "CI/CD pipeline",
      configured: isCicdWebhookConfigured(),
      status: !isCicdWebhookConfigured()
        ? "unavailable"
        : hasCicdEvidence(timeline, changeEvents)
          ? "collected"
          : "missing",
      detail: hasCicdEvidence(timeline, changeEvents)
        ? hasFailedCicdEvidence(timeline, changeEvents)
          ? "Pipeline failure/retry correlated — build → test → deploy chain visible"
          : "CI/CD stage events correlated to incident window"
        : isCicdWebhookConfigured()
          ? "CI/CD webhook configured — no pipeline events in window"
          : "Set CICD_WEBHOOK_SECRET for GitHub Actions / Jenkins events",
    },
    {
      id: "ebpf_signals",
      label: "eBPF / kernel signals",
      configured: isEbpfWebhookConfigured() || signozConfigured,
      status:
        !isEbpfWebhookConfigured() && !signozConfigured
          ? "unavailable"
          : ebpfCount > 0
            ? "collected"
            : isLatencyAlert
              ? "missing"
              : "partial",
      detail:
        ebpfCount > 0
          ? hasObiEbpfEvidence(timeline)
            ? `${ebpfCount} eBPF entries — OBI kernel/network signals collected`
            : `${ebpfCount} eBPF timeline entries`
          : isEbpfWebhookConfigured()
            ? "eBPF webhook configured — no kernel signals in window"
            : "Optional: OBI → SigNoz or POST /webhooks/ebpf",
    },
  ];

  const applicable = sources.filter((source) => {
    if (source.id === "signoz_metrics" && !isLatencyAlert) return false;
    if (source.id === "ebpf_signals" && !isLatencyAlert && ebpfCount === 0) return false;
    if (source.id === "github_api") return false;
    return source.configured || source.id === "signoz_alert";
  });

  const collectedApplicable = applicable.filter((source) => source.status === "collected");
  const completenessPercent =
    applicable.length === 0
      ? 0
      : Math.round((collectedApplicable.length / applicable.length) * 100);

  const missingForConclusion: string[] = [];
  if (!hasAlert) missingForConclusion.push("SigNoz alert evidence");
  if (signozConfigured && traceCount < MIN_TRACE_TIMELINE && logCount < MIN_LOG_TIMELINE) {
    missingForConclusion.push("Trace or log evidence from SigNoz");
  }
  if (isLatencyAlert && signozConfigured && metricCount === 0) {
    missingForConclusion.push("Latency metric enrichment");
  }
  if (
    (isGithubWebhookConfigured() || isGithubApiConfigured()) &&
    !hasDeployEvidence(timeline, changeEvents)
  ) {
    missingForConclusion.push("Deployment metadata (GitHub push in window)");
  }
  if (isKubernetesWebhookConfigured() && !hasKubernetesEvidence(timeline, changeEvents)) {
    missingForConclusion.push("Kubernetes pod/cluster events");
  }

  const canConclude =
    status === "ready" &&
    hasAlert &&
    (traceCount >= MIN_TRACE_TIMELINE || logCount >= MIN_LOG_TIMELINE || !signozConfigured);

  const recommendedNextSteps: string[] = [];
  if (!signozConfigured) {
    recommendedNextSteps.push("Configure SIGNOZ_CLOUD_URL and SIGNOZ_API_KEY for trace/log enrichment");
  }
  if (signozConfigured && traceCount < MIN_TRACE_TIMELINE) {
    recommendedNextSteps.push("Expand incident window or verify traces exist for the affected service in SigNoz");
  }
  if (signozConfigured && logCount < MIN_LOG_TIMELINE) {
    recommendedNextSteps.push("Check SigNoz logs for error patterns on the primary service");
  }
  if (!isGithubWebhookConfigured()) {
    recommendedNextSteps.push("Connect GitHub webhook for deploy correlation");
  } else if (!hasDeployEvidence(timeline, changeEvents)) {
    recommendedNextSteps.push("Confirm a deploy/push occurred near the incident start time");
  }
  if (!isGithubApiConfigured()) {
    recommendedNextSteps.push("Set GITHUB_TOKEN to enable pinpoint file fetch and suggest fix context");
  }
  if (isKubernetesWebhookConfigured() && !hasKubernetesEvidence(timeline, changeEvents)) {
    recommendedNextSteps.push("Verify kubernetes-event-exporter is posting to /webhooks/kubernetes");
  }
  if (isLatencyAlert && ebpfCount === 0) {
    recommendedNextSteps.push("Add OBI/eBPF signals for tail latency investigations (optional)");
  }
  if (canConclude && !isOpenAiConfigured()) {
    recommendedNextSteps.push("Set OPENAI_API_KEY to generate evidence-backed root cause summary");
  }

  let summary: string;
  if (status === "building") {
    summary = "Evidence collection in progress…";
  } else if (canConclude) {
    summary = `Investigation completeness ${completenessPercent}% — sufficient core evidence to reason about root cause.`;
  } else {
    summary = `Investigation completeness ${completenessPercent}% — unable to conclude; additional evidence required.`;
  }

  return {
    completenessPercent,
    canConclude,
    summary,
    missingForConclusion,
    recommendedNextSteps: recommendedNextSteps.slice(0, 6),
    sources,
  };
}
