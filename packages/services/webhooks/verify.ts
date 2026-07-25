import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

import { checkDistributedRateLimit } from "../cache/rate-limit";
import { hashWebhookSecret } from "../crypto/secrets";
import { resolveOrganizationIdForWebhookSecret } from "../organization/integrations";
import type { WebhookSecretProvider } from "@repo/database/schema";

/** 120 req/min per secret — generous for real agents/CI, tight enough to blunt a compromised-secret spam/brute-force run. */
const WEBHOOK_SECRET_RATE_LIMIT = { max: 120, windowMs: 60_000 };

/** Rate-limits by the secret itself (not IP) so a scoped-per-tenant secret can't be used to spam the shared handler. */
export async function checkWebhookSecretRateLimit(
  res: Response,
  provider: string,
  secret: string,
): Promise<boolean> {
  const key = `webhook-secret:${provider}:${hashWebhookSecret(secret)}`;
  const result = await checkDistributedRateLimit(key, WEBHOOK_SECRET_RATE_LIMIT.max, WEBHOOK_SECRET_RATE_LIMIT.windowMs);
  res.setHeader("RateLimit-Limit", String(result.limit));
  res.setHeader("RateLimit-Remaining", String(result.remaining));
  if (!result.allowed) {
    res.status(429).json({ error: "Too many requests for this webhook secret" });
    return false;
  }
  return true;
}

/**
 * Multi-tenant webhook auth for the shared-secret providers (kubernetes/ebpf/feature_flag/cicd):
 * resolves the organization from the secret itself via an indexed DB lookup (per-tenant secret,
 * generated in Settings), falling back to the single global env var for single-tenant/dev setups
 * that haven't connected via the UI yet. Accepts the secret via a custom header (works for
 * LaunchDarkly/GitHub Actions/etc.) or a `?token=` query param (for webhook tools that only let you
 * configure a URL, no custom headers — e.g. many Zapier-style integrations).
 */
export async function requireOrgWebhookAuth(
  req: Request,
  res: Response,
  options: { provider: WebhookSecretProvider; envKey: string; headerName: string },
): Promise<{ ok: true; organizationId: string | null } | { ok: false }> {
  const headerValue = req.headers[options.headerName.toLowerCase()];
  const queryValue = req.query.token;
  const provided =
    typeof headerValue === "string" ? headerValue : typeof queryValue === "string" ? queryValue : undefined;
  const secret = provided?.trim();

  if (secret) {
    const organizationId = await resolveOrganizationIdForWebhookSecret(options.provider, secret);
    if (organizationId) {
      if (!(await checkWebhookSecretRateLimit(res, options.provider, secret))) return { ok: false };
      return { ok: true, organizationId };
    }

    const envSecret = process.env[options.envKey]?.trim();
    if (envSecret && secret === envSecret) {
      return { ok: true, organizationId: null };
    }

    res.status(401).json({ error: "Invalid webhook secret" });
    return { ok: false };
  }

  const legacyOk = requireWebhookSecret(req, res, options.envKey, options.headerName);
  if (!legacyOk) return { ok: false };

  return { ok: true, organizationId: null };
}

export function requireWebhookSecret(
  req: Request,
  res: Response,
  envKey: string,
  headerName: string,
): boolean {
  const secret = process.env[envKey]?.trim();
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      res.status(503).json({ error: `${envKey} required in production` });
      return false;
    }
    return true;
  }

  const provided = req.headers[headerName.toLowerCase()];
  if (provided !== secret) {
    res.status(401).json({ error: "Invalid webhook secret" });
    return false;
  }

  return true;
}

export function verifyGithubHmac(req: Request, res: Response): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      res.status(503).json({ error: "GITHUB_WEBHOOK_SECRET required in production" });
      return false;
    }
    return true;
  }

  const signature = req.headers["x-hub-signature-256"];
  if (typeof signature !== "string" || !signature.startsWith("sha256=")) {
    // Fallback: custom header for local dev tunnels
    const custom = req.headers["x-evolvex-github-secret"];
    if (custom === secret) return true;
    res.status(401).json({ error: "Missing X-Hub-Signature-256" });
    return false;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    res.status(400).json({ error: "Raw body required for HMAC verification" });
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = signature.slice("sha256=".length);

  try {
    const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(received));
    if (!ok) {
      res.status(401).json({ error: "Invalid GitHub signature" });
      return false;
    }
    return true;
  } catch {
    res.status(401).json({ error: "Invalid GitHub signature" });
    return false;
  }
}
