import type { SignozAlert } from "./types";

export type AlertClassification = {
  kind: "latency_percentile" | "error" | "metric" | "unknown";
  percentile: "p50" | "p90" | "p95" | "p99" | null;
};

function alertHaystack(alert: SignozAlert) {
  return [
    alert.labels.alertname,
    alert.annotations.summary,
    alert.annotations.info,
    alert.annotations.description,
    ...Object.values(alert.labels),
    ...Object.values(alert.annotations),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function classifySignozAlert(alert: SignozAlert): AlertClassification {
  const haystack = alertHaystack(alert);

  let percentile: AlertClassification["percentile"] = null;
  if (/\bp99\b|99th percentile|p\s*99/.test(haystack)) percentile = "p99";
  else if (/\bp95\b|95th percentile|p\s*95/.test(haystack)) percentile = "p95";
  else if (/\bp90\b|90th percentile|p\s*90/.test(haystack)) percentile = "p90";
  else if (/\bp50\b|median/.test(haystack)) percentile = "p50";

  const latencyHint = /latency|duration|response time|tail latency|percentile|histogram/.test(haystack);

  if (percentile && (latencyHint || haystack.includes("ms"))) {
    return { kind: "latency_percentile", percentile };
  }

  if (/error|exception|fail|5xx|4xx/.test(haystack)) {
    return { kind: "error", percentile: null };
  }

  if (latencyHint) {
    return { kind: "latency_percentile", percentile: percentile ?? "p99" };
  }

  return { kind: "metric", percentile: null };
}

export function percentileLabel(percentile: AlertClassification["percentile"]) {
  return percentile?.toUpperCase() ?? "TAIL LATENCY";
}
