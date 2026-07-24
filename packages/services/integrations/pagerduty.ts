import { logger } from "@repo/logger";

export function isPagerDutyConfigured(routingKey?: string | null): boolean {
  return Boolean(routingKey?.trim() || process.env.PAGERDUTY_ROUTING_KEY?.trim());
}

export type PagerDutyInvestigationNotification = {
  kind: "investigation_ready" | "case_resolved";
  shortId: string;
  title: string;
  primaryService?: string | null;
  severity?: string | null;
  caseUrl?: string | null;
  summary?: string | null;
};

function mapSeverity(severity?: string | null): "critical" | "error" | "warning" | "info" {
  const normalized = severity?.toLowerCase() ?? "";
  if (normalized.includes("critical") || normalized.includes("sev1")) return "critical";
  if (normalized.includes("high") || normalized.includes("error")) return "error";
  if (normalized.includes("medium") || normalized.includes("warn")) return "warning";
  return "info";
}

/** Sends a PagerDuty Events API v2 trigger. No-op when routing key is unset. */
export async function sendPagerDutyInvestigationNotification(
  input: PagerDutyInvestigationNotification,
  routingKeyOverride?: string | null,
): Promise<{ sent: boolean; reason?: string }> {
  const routingKey = routingKeyOverride?.trim() || process.env.PAGERDUTY_ROUTING_KEY?.trim();
  if (!routingKey) {
    return { sent: false, reason: "PAGERDUTY_ROUTING_KEY not configured" };
  }

  const isResolved = input.kind === "case_resolved";
  const summary =
    input.kind === "investigation_ready"
      ? `Evolvex investigation ready · ${input.shortId}`
      : `Evolvex case resolved · ${input.shortId}`;

  const payload = {
    routing_key: routingKey,
    event_action: isResolved ? "resolve" : "trigger",
    dedup_key: `evolvex-${input.shortId}`,
    payload: {
      summary,
      source: input.primaryService ?? "evolvex",
      severity: isResolved ? "info" : mapSeverity(input.severity),
      component: input.primaryService ?? "unknown",
      custom_details: {
        shortId: input.shortId,
        title: input.title,
        severity: input.severity ?? "unknown",
        summary: input.summary ?? null,
        caseUrl: input.caseUrl ?? null,
        kind: input.kind,
      },
    },
    links: input.caseUrl ? [{ href: input.caseUrl, text: "Open in Evolvex" }] : undefined,
  };

  try {
    const response = await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.warn("PagerDuty rejected notification", {
        status: response.status,
        body: body.slice(0, 200),
      });
      return { sent: false, reason: `PagerDuty returned ${response.status}` };
    }

    return { sent: true };
  } catch (error) {
    logger.warn("PagerDuty notification failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: "network error" };
  }
}
