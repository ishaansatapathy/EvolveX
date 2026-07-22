import { getDefaultServiceName } from "../signoz-env";
import type { SignozAlert, SignozWebhookPayload } from "./types";

const SERVICE_LABEL_KEYS = [
  "service.name",
  "service_name",
  "service",
  "deployment",
  "deployment_name",
  "job",
  "k8s.deployment.name",
  "k8s.pod.name",
] as const;

function collectServiceCandidates(labels: Record<string, string | undefined>) {
  return SERVICE_LABEL_KEYS.map((key) => labels[key]).filter(Boolean) as string[];
}

export function extractServiceNames(
  alert: SignozAlert,
  context?: Pick<SignozWebhookPayload, "commonLabels" | "groupLabels">,
): string[] {
  const merged = {
    ...context?.groupLabels,
    ...context?.commonLabels,
    ...alert.labels,
  };

  const candidates = collectServiceCandidates(merged);
  if (candidates.length > 0) return [...new Set(candidates)];

  const defaultService = getDefaultServiceName();
  return defaultService ? [defaultService] : [];
}

export function buildInvestigationTitle(alert: SignozAlert): string {
  const alertName = alert.labels.alertname ?? "SigNoz alert";
  const summary = alert.annotations.summary?.trim();
  if (summary) return summary;
  const info = alert.annotations.info?.trim();
  if (info) return info;
  return alertName;
}

export function parseAlertTime(value: string | undefined): Date | null {
  if (!value || value.startsWith("0001-01-01")) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function incidentWindowFromAlert(alert: SignozAlert): { start: Date; end: Date } {
  const start = parseAlertTime(alert.startsAt) ?? new Date(Date.now() - 15 * 60 * 1000);
  const resolvedEnd = parseAlertTime(alert.endsAt ?? undefined);
  const end = resolvedEnd ?? new Date();
  return { start, end: end.getTime() <= start.getTime() ? new Date(start.getTime() + 30 * 60 * 1000) : end };
}

export function isResolvedAlert(payload: SignozWebhookPayload, alert: SignozAlert) {
  return payload.status === "resolved" || alert.status === "resolved";
}

export function shortInvestigationId(uuid: string) {
  return `INV-${uuid.slice(0, 8).toUpperCase()}`;
}
