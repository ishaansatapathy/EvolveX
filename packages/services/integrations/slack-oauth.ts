import { getSlackOAuthConfig, isSlackOAuthConfigured } from "../env";

export { isSlackOAuthConfigured };

const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";

/**
 * "Add to Slack" self-service connect (feature parity with SigNoz's API-key-in-Settings flow,
 * but for Slack no key ever needs to be found/copied by the user — they just click and approve).
 * Bot scope `incoming-webhook` is the minimal grant that returns a ready-to-use webhook URL,
 * matching what `sendSlackInvestigationNotification` already expects.
 */
const SLACK_BOT_SCOPES = ["incoming-webhook"] as const;

export function buildSlackAuthorizeUrl(state: string, redirectUri: string): string {
  const { clientId } = getSlackOAuthConfig();
  if (!clientId) throw new Error("Slack OAuth is not configured (SLACK_CLIENT_ID missing)");

  const url = new URL(SLACK_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export type SlackOAuthConnection = {
  teamId: string;
  teamName: string;
  webhookUrl: string;
  webhookChannel: string | null;
  botAccessToken: string;
};

type SlackOAuthAccessResponse = {
  ok: boolean;
  error?: string;
  access_token?: string;
  team?: { id?: string; name?: string };
  incoming_webhook?: { url?: string; channel?: string; configuration_url?: string };
};

/** Exchanges the OAuth `code` for a bot token + incoming webhook — no client secret ever touches the browser. */
export async function exchangeSlackOAuthCode(
  code: string,
  redirectUri: string,
): Promise<SlackOAuthConnection> {
  const { clientId, clientSecret } = getSlackOAuthConfig();
  if (!clientId || !clientSecret) {
    throw new Error("Slack OAuth is not configured (SLACK_CLIENT_ID/SLACK_CLIENT_SECRET missing)");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetch(SLACK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = (await response.json().catch(() => null)) as SlackOAuthAccessResponse | null;

  if (!response.ok || !json?.ok) {
    const reason = json?.error ?? `HTTP ${response.status}`;
    throw new Error(`Slack rejected the OAuth exchange: ${reason}`);
  }

  if (!json.incoming_webhook?.url || !json.access_token || !json.team?.id) {
    throw new Error("Slack OAuth response is missing the incoming webhook — re-authorize and try again");
  }

  return {
    teamId: json.team.id,
    teamName: json.team.name ?? "Slack workspace",
    webhookUrl: json.incoming_webhook.url,
    webhookChannel: json.incoming_webhook.channel ?? null,
    botAccessToken: json.access_token,
  };
}
