import { z } from "zod";

/** kubernetes-event-exporter / custom forwarder payload */
export const kubernetesEventSchema = z.object({
  reason: z.string().optional(),
  message: z.string().optional(),
  type: z.string().optional(),
  involvedObject: z
    .object({
      kind: z.string().optional(),
      name: z.string().optional(),
      namespace: z.string().optional(),
    })
    .optional(),
  source: z
    .object({
      component: z.string().optional(),
      host: z.string().optional(),
    })
    .optional(),
  firstTimestamp: z.string().optional(),
  lastTimestamp: z.string().optional(),
  metadata: z
    .object({
      name: z.string().optional(),
      namespace: z.string().optional(),
    })
    .optional(),
  /** Cluster metadata forwarded by evolvex-agent Helm chart */
  clusterVersion: z.string().optional(),
  namespace: z.string().optional(),
  /** ArgoCD / Flux style deploy notification */
  service: z.string().optional(),
  revision: z.string().optional(),
  status: z.string().optional(),
});

export type KubernetesEventPayload = z.infer<typeof kubernetesEventSchema>;

export function parseKubernetesEvent(payload: KubernetesEventPayload) {
  const kind = payload.involvedObject?.kind ?? "Event";
  const name = payload.involvedObject?.name ?? payload.metadata?.name ?? "unknown";
  const namespace = payload.involvedObject?.namespace ?? payload.metadata?.namespace ?? "default";
  const reason = payload.reason ?? payload.status ?? "Changed";
  const message = payload.message ?? `${kind} ${name} — ${reason}`;
  const service =
    payload.service ??
    (kind === "Deployment" || kind === "Pod" || kind === "ReplicaSet"
      ? name.replace(/-[a-z0-9]{5,12}$/i, "").replace(/-deploy$/i, "")
      : name);

  const occurredAt = payload.lastTimestamp
    ? new Date(payload.lastTimestamp)
    : payload.firstTimestamp
      ? new Date(payload.firstTimestamp)
      : new Date();

  const severity = classifyKubernetesSeverity(reason, message);
  const title =
    severity === "critical"
      ? `K8s incident · ${kind} ${reason}`
      : `K8s ${kind}: ${reason}`;

  return {
    kind,
    name,
    namespace,
    reason,
    message,
    service,
    revision: payload.revision,
    occurredAt,
    severity,
    title,
    detail: `[${namespace}/${name}] ${message}`,
    fingerprint: `${namespace}|${kind}|${name}|${reason}`.toLowerCase(),
  };
}

export function classifyKubernetesSeverity(reason: string, message: string): "critical" | "warning" | "info" {
  const blob = `${reason} ${message}`.toLowerCase();
  if (
    /oom|crashloop|failed|error|backoff|unhealthy|evicted|kill|imagepull|failedscheduling|node not ready/.test(
      blob,
    )
  ) {
    return "critical";
  }
  if (/warning|pending|progressing|scaling|restart/.test(blob)) {
    return "warning";
  }
  return "info";
}
