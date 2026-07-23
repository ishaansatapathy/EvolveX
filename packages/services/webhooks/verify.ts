import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

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
