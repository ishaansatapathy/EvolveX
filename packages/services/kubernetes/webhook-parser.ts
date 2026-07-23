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
    (kind === "Deployment" || kind === "Pod" ? name.replace(/-[a-z0-9]{5,10}$/, "") : name);

  const occurredAt = payload.lastTimestamp
    ? new Date(payload.lastTimestamp)
    : payload.firstTimestamp
      ? new Date(payload.firstTimestamp)
      : new Date();

  return {
    kind,
    name,
    namespace,
    reason,
    message,
    service,
    revision: payload.revision,
    occurredAt,
    title: `K8s ${kind}: ${reason}`,
    detail: `[${namespace}/${name}] ${message}`,
  };
}
