import express from "express";
import type { Request } from "express";
import { logger } from "@repo/logger";
import InvestigationService from "@repo/services/investigation";
import { githubPushPayloadSchema } from "@repo/services/github/webhook-parser";
import { verifyGithubHmac } from "@repo/services/webhooks/verify";

const investigationService = new InvestigationService();

export const githubWebhookRouter = express.Router();

/** Preserve raw body for X-Hub-Signature-256 verification */
githubWebhookRouter.use(
  express.json({
    limit: "512kb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

githubWebhookRouter.get("/", (_req, res) => {
  const baseUrl = process.env.BASE_URL?.trim() || "http://localhost:8000";
  return res.json({
    ok: true,
    message: "Evolvex GitHub webhook endpoint",
    events: ["push"],
    webhookUrl: `${baseUrl.replace(/\/+$/, "")}/webhooks/github`,
    webhookAuthConfigured: Boolean(process.env.GITHUB_WEBHOOK_SECRET?.trim()),
    signatureHeader: "X-Hub-Signature-256",
  });
});

githubWebhookRouter.post("/", async (req, res) => {
  if (!verifyGithubHmac(req, res)) return;

  const event = req.headers["x-github-event"];
  if (event !== "push") {
    return res.status(200).json({ ok: true, ignored: true, event });
  }

  const parsed = githubPushPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid GitHub push payload" });
  }

  try {
    const result = await investigationService.handleGithubWebhook(parsed.data);
    logger.info("GitHub webhook processed", result);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logger.error("GitHub webhook handler failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: "GitHub webhook processing failed" });
  }
});
