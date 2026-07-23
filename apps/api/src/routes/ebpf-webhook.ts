import express from "express";
import { logger } from "@repo/logger";
import InvestigationService from "@repo/services/investigation";
import { ebpfEventSchema } from "@repo/services/ebpf/webhook-parser";
import { requireWebhookSecret } from "@repo/services/webhooks/verify";

const investigationService = new InvestigationService();

export const ebpfWebhookRouter = express.Router();

ebpfWebhookRouter.get("/", (_req, res) => {
  const baseUrl = process.env.BASE_URL?.trim() || "http://localhost:8000";
  return res.json({
    ok: true,
    message: "Evolvex eBPF webhook endpoint",
    webhookUrl: `${baseUrl.replace(/\/+$/, "")}/webhooks/ebpf`,
    webhookAuthConfigured: Boolean(process.env.EBPF_WEBHOOK_SECRET?.trim()),
  });
});

ebpfWebhookRouter.post("/", async (req, res) => {
  if (!requireWebhookSecret(req, res, "EBPF_WEBHOOK_SECRET", "x-evolvex-ebpf-secret")) return;

  const parsed = ebpfEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid eBPF event payload" });
  }

  try {
    const result = await investigationService.handleEbpfWebhook(parsed.data);
    logger.info("eBPF webhook processed", result);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logger.error("eBPF webhook handler failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: "eBPF webhook processing failed" });
  }
});
