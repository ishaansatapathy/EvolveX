import express from "express";
import type { Request, Response } from "express";
import { logger } from "@repo/logger";
import InvestigationService from "@repo/services/investigation";
import { getSignozConfig } from "@repo/services/signoz-env";
import { signozWebhookPayloadSchema } from "@repo/services/signoz/types";

const investigationService = new InvestigationService();

const webhookHits = new Map<string, { count: number; resetAt: number }>();
const WEBHOOK_RATE_WINDOW_MS = 60_000;
const WEBHOOK_RATE_MAX = Number.parseInt(process.env.SIGNOZ_WEBHOOK_RATE_LIMIT ?? "120", 10);

function isRateLimited(req: Request) {
  const key = req.ip ?? "unknown";
  const now = Date.now();
  const entry = webhookHits.get(key);
  if (!entry || now >= entry.resetAt) {
    webhookHits.set(key, { count: 1, resetAt: now + WEBHOOK_RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > WEBHOOK_RATE_MAX;
}

export const signozWebhookRouter = express.Router();

signozWebhookRouter.get("/", (_req, res) => {
  const config = getSignozConfig();
  return res.json({
    ok: true,
    message: "Evolvex SigNoz webhook endpoint",
    signozApiConfigured: Boolean(config),
    webhookAuthConfigured: Boolean(config?.webhookSecret),
  });
});

function verifyWebhookAuth(req: Request, res: Response): boolean {
  const secret = getSignozConfig()?.webhookSecret;
  if (!secret) return true;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Basic ")) {
    res.status(401).json({ error: "Missing basic auth" });
    return false;
  }

  const encoded = authHeader.slice("Basic ".length);
  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    res.status(401).json({ error: "Invalid basic auth" });
    return false;
  }

  const [, password] = decoded.split(":");
  if (password !== secret) {
    res.status(401).json({ error: "Invalid webhook credentials" });
    return false;
  }

  return true;
}

signozWebhookRouter.post("/", async (req, res) => {
  if (isRateLimited(req)) {
    return res.status(429).json({ error: "Webhook rate limit exceeded" });
  }

  if (!verifyWebhookAuth(req, res)) return;

  const parsed = signozWebhookPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn("Invalid SigNoz webhook payload", { issues: parsed.error.issues });
    return res.status(400).json({ error: "Invalid webhook payload" });
  }

  try {
    const result = await investigationService.handleSignozWebhook(parsed.data);
    logger.info("SigNoz webhook processed", {
      alertCount: parsed.data.alerts.length,
      status: parsed.data.status,
      investigationIds: result.investigationIds,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logger.error("SigNoz webhook handler failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});
