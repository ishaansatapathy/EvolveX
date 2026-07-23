import type { SignozAlert } from "../signoz/types";
import { classifySignozAlert, percentileLabel, type AlertClassification } from "../signoz/alert-classifier";
import type { SignozTraceRow } from "../signoz/types";
import type { InvestigationContext } from "./types";

export function needsEbpfEnrichment(context: InvestigationContext): boolean {
  return context.alertKind === "latency_percentile";
}

export function signozAlertToMetricEvidence(
  alert: SignozAlert,
  classification: AlertClassification,
  occurredAt: string,
): InvestigationContext["evidence"][number] | null {
  if (classification.kind !== "latency_percentile") return null;

  const label = percentileLabel(classification.percentile);
  const signozSummary =
    alert.annotations.summary?.trim() ||
    alert.annotations.info?.trim() ||
    `${label} latency threshold breached on ${alert.labels.alertname ?? "service"}.`;

  return {
    id: "metric-signoz-percentile",
    kind: "METRIC",
    title: `${label} detected by SigNoz (not computed by Evolvex)`,
    detail: `${signozSummary} SigNoz calculates latency percentiles from trace distributions — Evolvex investigates why tail latency degraded.`,
    occurredAt,
    source: "signoz-alert",
  };
}

export function buildContextSummary(input: {
  alertName: string;
  affectedServices: string[];
  traceCount: number;
  signozConfigured: boolean;
  classification: AlertClassification;
}): string {
  const services =
    input.affectedServices.length > 0
      ? input.affectedServices.join(", ")
      : "unknown service(s)";

  if (input.classification.kind === "latency_percentile") {
    const label = percentileLabel(input.classification.percentile);
    const traceNote =
      input.traceCount > 0
        ? `${input.traceCount} slow trace(s) in the tail of the distribution were collected from SigNoz.`
        : input.signozConfigured
          ? "No slow traces matched yet — SigNoz already fired the percentile alert."
          : "SigNoz API not configured — trace enrichment skipped.";

    return `SigNoz detected ${label} latency degradation for ${services}. Averages can look healthy while tail latency hurts users — ${traceNote} Review deploy and runtime evidence before concluding root cause.`;
  }

  const traceNote =
    input.traceCount > 0
      ? `${input.traceCount} error trace(s) collected from SigNoz in the incident window.`
      : input.signozConfigured
        ? "No matching error traces found in SigNoz for the incident window."
        : "SigNoz API not configured — trace enrichment skipped.";

  return `Alert "${input.alertName}" fired for ${services}. ${traceNote} Review the evidence timeline before drawing conclusions.`;
}

export function tracesToEvidence(
  traces: SignozTraceRow[],
  mode: "error" | "slow" = "error",
): InvestigationContext["evidence"] {
  return traces.map((trace, index) => ({
    id: `trace-${trace.traceId || trace.spanId || index}`,
    kind: "TRACE" as const,
    title:
      mode === "slow"
        ? trace.name
          ? `Slow span: ${trace.name}`
          : "Slow span (tail latency candidate)"
        : trace.name || "Error span",
    detail: [
      trace.serviceName ? `Service: ${trace.serviceName}` : null,
      trace.durationMs != null ? `Duration: ${trace.durationMs}ms` : null,
      mode === "slow" ? "Tail latency candidate (p95/p99 driver)" : null,
      trace.traceId ? `Trace: ${trace.traceId}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    occurredAt: trace.timestamp || new Date().toISOString(),
    source: "signoz",
  }));
}

export function classifyInvestigationAlert(alert: SignozAlert | undefined): AlertClassification {
  if (!alert) return { kind: "unknown", percentile: null };
  return classifySignozAlert(alert);
}
