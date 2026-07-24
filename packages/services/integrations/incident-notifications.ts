import {
  resolvePagerDutyRoutingKey,
  resolveSlackWebhookUrl,
} from "../organization/integrations";
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
  organizationId?: string | null;
};

/** Fan-out investigation lifecycle alerts to all configured on-call channels. */
export async function notifyInvestigationLifecycle(input: IncidentNotificationInput) {
  const [slackWebhookUrl, pagerDutyRoutingKey] = await Promise.all([
    resolveSlackWebhookUrl(input.organizationId),
    resolvePagerDutyRoutingKey(input.organizationId),
  ]);

  const [slack, pagerduty] = await Promise.all([
    sendSlackInvestigationNotification(input, slackWebhookUrl),
    sendPagerDutyInvestigationNotification(input, pagerDutyRoutingKey),
  ]);

  return { slack, pagerduty };
}
