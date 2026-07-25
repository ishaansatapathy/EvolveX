import { getIntegrationBaseUrl } from "../integrations/config";

export type GithubWebhookRegistrationResult = {
  ok: boolean;
  message: string;
  hookId?: number;
  action?: "created" | "updated" | "existing";
};

const WEBHOOK_EVENTS = ["push", "deployment", "deployment_status", "release"] as const;

function parseRepositoryFullName(value: string) {
  const trimmed = value.trim();
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]! };
}

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "Evolvex-Investigation-OS",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** Feature #28 — register deploy webhook via GitHub REST API (no OAuth app required). */
export async function registerGithubRepositoryWebhook(input: {
  token: string;
  repositoryFullName: string;
  webhookSecret: string;
  webhookUrl?: string;
}): Promise<GithubWebhookRegistrationResult> {
  const repository = parseRepositoryFullName(input.repositoryFullName);
  if (!repository) {
    return { ok: false, message: "Repository must be in owner/repo format (e.g. acme/payments-api)" };
  }

  const secret = input.webhookSecret.trim();
  if (!secret) {
    return { ok: false, message: "Webhook secret is required to register a GitHub hook" };
  }

  const webhookUrl = (input.webhookUrl ?? `${getIntegrationBaseUrl()}/webhooks/github`).replace(/\/+$/, "");
  const listUrl = `https://api.github.com/repos/${repository.owner}/${repository.repo}/hooks`;

  const listResponse = await fetch(listUrl, { headers: githubHeaders(input.token) });
  if (!listResponse.ok) {
    const hint =
      listResponse.status === 404
        ? " — repository not found or token lacks access"
        : listResponse.status === 403
          ? " — token needs admin:repo_hook or repo scope"
          : "";
    return { ok: false, message: `GitHub hooks lookup failed (${listResponse.status})${hint}` };
  }

  const hooks = (await listResponse.json()) as Array<{
    id: number;
    config?: { url?: string };
  }>;

  const existing = hooks.find((hook) => hook.config?.url === webhookUrl);

  if (existing) {
    const patchResponse = await fetch(`${listUrl}/${existing.id}`, {
      method: "PATCH",
      headers: { ...githubHeaders(input.token), "Content-Type": "application/json" },
      body: JSON.stringify({
        active: true,
        events: [...WEBHOOK_EVENTS],
        config: {
          url: webhookUrl,
          content_type: "json",
          secret,
          insecure_ssl: "0",
        },
      }),
    });

    if (!patchResponse.ok) {
      return { ok: false, message: `Failed to update existing GitHub webhook (${patchResponse.status})` };
    }

    return {
      ok: true,
      message: `GitHub webhook updated for ${repository.owner}/${repository.repo}`,
      hookId: existing.id,
      action: "updated",
    };
  }

  const createResponse = await fetch(listUrl, {
    method: "POST",
    headers: { ...githubHeaders(input.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "web",
      active: true,
      events: [...WEBHOOK_EVENTS],
      config: {
        url: webhookUrl,
        content_type: "json",
        secret,
        insecure_ssl: "0",
      },
    }),
  });

  if (!createResponse.ok) {
    const hint =
      createResponse.status === 422
        ? " — hook may already exist with a different URL; remove old hooks in GitHub settings"
        : createResponse.status === 403
          ? " — token needs admin:repo_hook or repo scope"
          : "";
    return { ok: false, message: `GitHub webhook registration failed (${createResponse.status})${hint}` };
  }

  const created = (await createResponse.json()) as { id?: number };
  return {
    ok: true,
    message: `GitHub webhook registered for ${repository.owner}/${repository.repo}`,
    hookId: created.id,
    action: "created",
  };
}
