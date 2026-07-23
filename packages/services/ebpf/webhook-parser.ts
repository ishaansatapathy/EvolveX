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
  const service = payload.service ?? payload.pod?.replace(/-[a-z0-9]{5,10}$/, "") ?? "unknown";
  const title = TYPE_LABELS[payload.type];
  const valuePart =
    payload.value != null
      ? ` — ${payload.value}${payload.unit ? ` ${payload.unit}` : ""}`
      : "";
  const detail =
    payload.message ??
    `${service}${payload.namespace ? ` (${payload.namespace})` : ""}: ${title.toLowerCase()}${valuePart}`;

  return {
    service,
    type: payload.type,
    title: payload.source === "obi" ? `${title} (OBI)` : title,
    detail,
    occurredAt: payload.timestamp ? new Date(payload.timestamp) : new Date(),
    metadata: {
      pod: payload.pod,
      namespace: payload.namespace,
      metric: payload.metric,
      value: payload.value,
      unit: payload.unit,
      collector: payload.source ?? "webhook",
      ...(payload.metadata ?? {}),
    },
  };
}
