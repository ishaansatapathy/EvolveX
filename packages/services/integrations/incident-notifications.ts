import { sendPagerDutyInvestigationNotification } from "./pagerduty";
import { sendSlackInvestigationNotification } from "./slack";

export type IncidentNotificationInput = {
  kind: "investigation_ready" | "case_resolved";
  shortId: string;
  title: string;
  primaryService?: string | null;
  severity?: string | null;
  caseUrl?: string | null;
  summary?: string | null;
};

/** Fan-out investigation lifecycle alerts to all configured on-call channels. */
export async function notifyInvestigationLifecycle(input: IncidentNotificationInput) {
  const [slack, pagerduty] = await Promise.all([
    sendSlackInvestigationNotification(input),
    sendPagerDutyInvestigationNotification(input),
  ]);

  return { slack, pagerduty };
}
