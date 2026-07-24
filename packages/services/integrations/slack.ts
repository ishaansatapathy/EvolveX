import { logger } from "@repo/logger";

export function isSlackConfigured(): boolean {
  return Boolean(process.env.SLACK_WEBHOOK_URL?.trim());
}

export type SlackInvestigationNotification = {
  kind: "investigation_ready" | "case_resolved";
  shortId: string;
  title: string;
  primaryService?: string | null;
  severity?: string | null;
  caseUrl?: string | null;
  summary?: string | null;
};

function buildSlackBlocks(input: SlackInvestigationNotification) {
  const headline =
    input.kind === "investigation_ready"
      ? "Investigation ready for review"
      : "Incident case resolved";

  const emoji = input.kind === "investigation_ready" ? ":mag:" : ":white_check_mark:";

  return {
    text: `${emoji} Evolvex · ${headline} · ${input.shortId}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `${emoji} ${headline}`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Case:*\n${input.shortId}` },
          { type: "mrkdwn", text: `*Service:*\n${input.primaryService ?? "unknown"}` },
          { type: "mrkdwn", text: `*Severity:*\n${input.severity ?? "unknown"}` },
          { type: "mrkdwn", text: `*Title:*\n${input.title}` },
        ],
      },
      input.summary
        ? {
            type: "section",
            text: { type: "mrkdwn", text: input.summary.slice(0, 500) },
          }
        : null,
      input.caseUrl
        ? {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Open in Evolvex" },
                url: input.caseUrl,
              },
            ],
          }
        : null,
    ].filter(Boolean),
  };
}

/** Sends a Slack incoming-webhook notification. No-op when SLACK_WEBHOOK_URL is unset. */
export async function sendSlackInvestigationNotification(
  input: SlackInvestigationNotification,
): Promise<{ sent: boolean; reason?: string }> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return { sent: false, reason: "SLACK_WEBHOOK_URL not configured" };
  }

  try {
    const payload = buildSlackBlocks(input);
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.warn("Slack webhook rejected notification", {
        status: response.status,
        body: body.slice(0, 200),
      });
      return { sent: false, reason: `Slack returned ${response.status}` };
    }

    return { sent: true };
  } catch (error) {
    logger.warn("Slack notification failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: "network error" };
  }
}
