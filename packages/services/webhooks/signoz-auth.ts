import type { Request, Response } from "express";

import { getSignozConfig } from "../signoz-env";
import { resolveOrganizationIdForWebhookSecret } from "../organization/integrations";
import { checkWebhookSecretRateLimit } from "./verify";

/** Extracts the password portion of a `Basic <base64(user:pass)>` Authorization header. */
function decodeBasicAuthPassword(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Basic ")) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(authHeader.slice("Basic ".length), "base64").toString("utf8");
  } catch {
    return null;
  }

  const separatorIndex = decoded.indexOf(":");
  return separatorIndex === -1 ? decoded : decoded.slice(separatorIndex + 1);
}

/**
 * Multi-tenant auth for the SigNoz alert webhook (`POST /webhooks/signoz`): resolves the owning
 * organization from the Basic-auth password via the same indexed `secret_hash` lookup
 * Kubernetes/eBPF/CI-CD webhooks use (`resolveOrganizationIdForWebhookSecret`). Each workspace
 * gets its own password from Settings → Connect SigNoz → Generate webhook credentials, so alerts
 * route straight to that workspace instead of always landing wherever `INVESTIGATION_OWNER_EMAIL`
 * points — no more re-pointing that env var every time a different tenant needs to test.
 *
 * Falls back to the single global `SIGNOZ_WEBHOOK_SECRET` (legacy single-tenant deployments), and
 * — only when neither a global nor any per-workspace secret has ever been configured — allows
 * unauthenticated requests, matching this endpoint's original zero-config local/dev behavior.
 */
export async function requireSignozWebhookAuth(
  req: Request,
  res: Response,
): Promise<{ ok: true; organizationId: string | null } | { ok: false }> {
  const password = decodeBasicAuthPassword(req.headers.authorization);

  if (password) {
    const organizationId = await resolveOrganizationIdForWebhookSecret("signoz", password);
    if (organizationId) {
      if (!(await checkWebhookSecretRateLimit(res, "signoz", password))) return { ok: false };
      return { ok: true, organizationId };
    }

    const envSecret = getSignozConfig()?.webhookSecret;
    if (envSecret && password === envSecret) {
      return { ok: true, organizationId: null };
    }

    res.status(401).json({ error: "Invalid webhook credentials" });
    return { ok: false };
  }

  if (req.headers.authorization) {
    res.status(401).json({ error: "Missing basic auth" });
    return { ok: false };
  }

  const envSecret = getSignozConfig()?.webhookSecret;
  if (envSecret) {
    res.status(401).json({ error: "Missing basic auth" });
    return { ok: false };
  }

  return { ok: true, organizationId: null };
}
