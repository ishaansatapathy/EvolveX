import type { InvestigationContext } from "../investigation/types";

/**
 * Metric names emitted by OpenTelemetry eBPF Instrumentation (OBI).
 * @see https://opentelemetry.io/docs/zero-code/obi/metrics/
 * Prometheus-style names as stored in SigNoz/Prometheus backends.
 */
export const OBI_METRIC_CANDIDATES = [
  "obi_stat_tcp_rtt_seconds",
  "obi_stat_tcp_failed_connections_total",
  "obi_network_flow_bytes_total",
  "obi_network_inter_zone_bytes_total",
  "http_server_request_duration_seconds",
  "http_client_request_duration_seconds",
  "rpc_server_duration_seconds",
  "rpc_client_duration_seconds",
] as const;

export type ObiMetricName = (typeof OBI_METRIC_CANDIDATES)[number];

export type ObiSignalKind =
  | "tcp_rtt"
  | "tcp_failed"
  | "network_flow"
  | "http_latency"
  | "rpc_latency";

export function classifyObiMetric(metricName: string): ObiSignalKind | null {
  const name = metricName.toLowerCase();

  if (name.includes("tcp_rtt") || name.includes("tcp.rtt")) return "tcp_rtt";
  if (name.includes("failed_connection") || name.includes("failed.connections")) return "tcp_failed";
  if (name.includes("network_flow") || name.includes("inter_zone")) return "network_flow";
  if (name.includes("http_") && name.includes("duration")) return "http_latency";
  if (name.includes("rpc_") && name.includes("duration")) return "rpc_latency";

  return null;
}

export function obiMetricToEvidence(
  sample: { metricName: string; value: number; timestamp: string },
  service: string,
): InvestigationContext["evidence"][number] | null {
  const kind = classifyObiMetric(sample.metricName);
  if (!kind) return null;

  const titles: Record<ObiSignalKind, string> = {
    tcp_rtt: "TCP RTT elevated (OBI kernel/network)",
    tcp_failed: "TCP connection failures (OBI kernel/network)",
    network_flow: "Network flow anomaly (OBI eBPF)",
    http_latency: "HTTP latency elevated (OBI zero-code trace)",
    rpc_latency: "gRPC/RPC latency elevated (OBI zero-code trace)",
  };

  const details: Record<ObiSignalKind, string> = {
    tcp_rtt: `${service}: ${sample.metricName} = ${sample.value.toFixed(4)}s — socket RTT degradation from OpenTelemetry eBPF Instrumentation.`,
    tcp_failed: `${service}: ${sample.metricName} = ${sample.value.toFixed(0)} failed connections — kernel-level connect failures observed by OBI.`,
    network_flow: `${service}: ${sample.metricName} = ${sample.value.toFixed(0)} bytes — abnormal inter-service traffic pattern from OBI network metrics.`,
    http_latency: `${service}: ${sample.metricName} = ${sample.value.toFixed(4)}s — application HTTP path slowdown captured without code changes (OBI).`,
    rpc_latency: `${service}: ${sample.metricName} = ${sample.value.toFixed(4)}s — RPC path slowdown captured without code changes (OBI).`,
  };

  return {
    id: `obi-metric-${sample.metricName}`,
    kind: "EBPF",
    title: titles[kind],
    detail: details[kind],
    occurredAt: sample.timestamp,
    source: "obi-signoz",
  };
}

/** Map elevated OBI metric to Evolvex eBPF webhook event type for the anomaly bridge. */
export function obiMetricToWebhookType(metricName: string): "tcp_retransmit" | "connect_latency" | "syscall_latency" | "custom" {
  const kind = classifyObiMetric(metricName);
  switch (kind) {
    case "tcp_rtt":
    case "tcp_failed":
      return "connect_latency";
    case "http_latency":
    case "rpc_latency":
      return "syscall_latency";
    case "network_flow":
      return "tcp_retransmit";
    default:
      return "custom";
  }
}
