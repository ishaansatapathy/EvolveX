import { z } from "zod";

/** Structured eBPF event from Cilium Hubble, Pixie, or custom collector */
export const ebpfEventSchema = z.object({
  type: z.enum([
    "tcp_retransmit",
    "connect_latency",
    "pool_pressure",
    "syscall_latency",
    "dns_latency",
    "packet_drop",
    "custom",
  ]),
  service: z.string().optional(),
  pod: z.string().optional(),
  namespace: z.string().optional(),
  metric: z.string().optional(),
  value: z.number().optional(),
  unit: z.string().optional(),
  message: z.string().optional(),
  timestamp: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Source collector — e.g. obi, hubble, pixie */
  source: z.enum(["obi", "hubble", "pixie", "custom"]).optional(),
});

export type EbpfEventPayload = z.infer<typeof ebpfEventSchema>;

const TYPE_LABELS: Record<EbpfEventPayload["type"], string> = {
  tcp_retransmit: "TCP retransmit rate elevated (kernel)",
  connect_latency: "connect() latency spike (kernel socket layer)",
  pool_pressure: "Connection pool pressure detected",
  syscall_latency: "Syscall latency elevated",
  dns_latency: "DNS resolution latency spike",
  packet_drop: "Packet drops detected (kernel)",
  custom: "Kernel/runtime signal",
};

export function parseEbpfEvent(payload: EbpfEventPayload) {
  const service = payload.service ?? payload.pod?.replace(/-[a-z0-9]{5,12}$/i, "") ?? "unknown";
  const title = TYPE_LABELS[payload.type];
  const valuePart =
    payload.value != null
      ? ` — ${payload.value}${payload.unit ? ` ${payload.unit}` : ""}`
      : "";
  const detail =
    payload.message ??
    `${service}${payload.namespace ? ` (${payload.namespace})` : ""}: ${title.toLowerCase()}${valuePart}`;

  const collector = payload.source ?? "webhook";
  const severity = classifyEbpfSeverity(payload.type, payload.value, payload.source);
  const signalLayer = classifyEbpfSignalLayer(payload.type, payload.source);
  const fingerprint = [
    payload.type,
    service,
    payload.metric ?? "",
    payload.pod ?? "",
    payload.namespace ?? "",
    collector,
  ]
    .join("|")
    .toLowerCase();

  return {
    service,
    type: payload.type,
    title: collector === "obi" ? `${title} (OBI)` : title,
    detail,
    occurredAt: payload.timestamp ? new Date(payload.timestamp) : new Date(),
    severity,
    signalLayer,
    collector,
    fingerprint,
    metadata: {
      pod: payload.pod,
      namespace: payload.namespace,
      metric: payload.metric,
      value: payload.value,
      unit: payload.unit,
      collector,
      signalLayer,
      severity,
      fingerprint,
      ...(payload.metadata ?? {}),
    },
  };
}

export function classifyEbpfSeverity(
  type: EbpfEventPayload["type"],
  value?: number,
  source?: EbpfEventPayload["source"],
): "critical" | "warning" | "info" {
  if (type === "tcp_retransmit" || type === "packet_drop" || type === "pool_pressure") {
    return "critical";
  }
  if (type === "connect_latency" || type === "syscall_latency" || type === "dns_latency") {
    if (value != null && value >= 0.5) return "critical";
    return "warning";
  }
  if (source === "obi") return "warning";
  return "info";
}

export function classifyEbpfSignalLayer(
  type: EbpfEventPayload["type"],
  source?: EbpfEventPayload["source"],
): "kernel" | "network" | "syscall" | "application" {
  if (type === "tcp_retransmit" || type === "packet_drop" || type === "connect_latency") {
    return source === "obi" ? "network" : "kernel";
  }
  if (type === "syscall_latency" || type === "dns_latency") return "syscall";
  if (type === "pool_pressure") return "application";
  return "kernel";
}
