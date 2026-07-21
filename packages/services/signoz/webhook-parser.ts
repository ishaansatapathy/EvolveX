import type { SignozAlert, SignozWebhookPayload } from "./types";

export function extractServiceNames(alert: SignozAlert): string[] {
  const labels = { ...alert.labels };
  const candidates = [
    labels["service.name"],
    labels["service_name"],
    labels["service"],
    labels["deployment"],
    labels["deployment_name"],
    labels["job"],
    labels["instance"],
  ].filter(Boolean) as string[];

  return [...new Set(candidates)];
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
