import type { SignozTraceRow } from "../signoz/types";
import type { InvestigationContext } from "./types";

export function needsEbpfEnrichment(_context: InvestigationContext): boolean {
  return false;
}

export function collectEbpfEvidence(): InvestigationContext["evidence"] {
  return [];
}

export function buildContextSummary(input: {
  alertName: string;
  affectedServices: string[];
  traceCount: number;
  signozConfigured: boolean;
}): string {
  const services =
    input.affectedServices.length > 0
      ? input.affectedServices.join(", ")
      : "unknown service(s)";

  const traceNote =
    input.traceCount > 0
      ? `${input.traceCount} error trace(s) collected from SigNoz in the incident window.`
      : input.signozConfigured
        ? "No matching error traces found in SigNoz for the incident window."
        : "SigNoz API not configured — trace enrichment skipped.";

  return `Alert "${input.alertName}" fired for ${services}. ${traceNote} Review the evidence timeline before drawing conclusions.`;
}

export function tracesToEvidence(traces: SignozTraceRow[]): InvestigationContext["evidence"] {
  return traces.map((trace, index) => ({
    id: `trace-${trace.traceId || trace.spanId || index}`,
    kind: "TRACE" as const,
    title: trace.name || "Error span",
    detail: [
      trace.serviceName ? `Service: ${trace.serviceName}` : null,
      trace.durationMs != null ? `Duration: ${trace.durationMs}ms` : null,
      trace.traceId ? `Trace: ${trace.traceId}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    occurredAt: trace.timestamp || new Date().toISOString(),
    source: "signoz",
  }));
}
