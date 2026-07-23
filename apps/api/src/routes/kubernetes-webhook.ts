import express from "express";
import { logger } from "@repo/logger";
import InvestigationService from "@repo/services/investigation";
import { kubernetesEventSchema } from "@repo/services/kubernetes/webhook-parser";
import { requireWebhookSecret } from "@repo/services/webhooks/verify";

const investigationService = new InvestigationService();

export const kubernetesWebhookRouter = express.Router();

kubernetesWebhookRouter.get("/", (_req, res) => {
  const baseUrl = process.env.BASE_URL?.trim() || "http://localhost:8000";
  return res.json({
    ok: true,
    message: "Evolvex Kubernetes webhook endpoint",
    webhookUrl: `${baseUrl.replace(/\/+$/, "")}/webhooks/kubernetes`,
    webhookAuthConfigured: Boolean(process.env.KUBERNETES_WEBHOOK_SECRET?.trim()),
  });
});

kubernetesWebhookRouter.post("/", async (req, res) => {
  if (!requireWebhookSecret(req, res, "KUBERNETES_WEBHOOK_SECRET", "x-evolvex-k8s-secret")) return;

  const parsed = kubernetesEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Kubernetes event payload" });
  }

  try {
    const result = await investigationService.handleKubernetesWebhook(parsed.data);
    logger.info("Kubernetes webhook processed", result);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logger.error("Kubernetes webhook handler failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: "Kubernetes webhook processing failed" });
  }
});
