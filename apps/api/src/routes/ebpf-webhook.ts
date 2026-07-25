import express from "express";
import { logger } from "@repo/logger";
import InvestigationService from "@repo/services/investigation";
import { ebpfEventSchema } from "@repo/services/ebpf/webhook-parser";
import { requireOrgWebhookAuth } from "@repo/services/webhooks/verify";
import { recordWebhookSignalEvent } from "@repo/services/organization/integrations";

import { resolveInvestigationOwnerUserId } from "@repo/services/investigation/owner";
import { resolveOrganizationForUser } from "@repo/services/organization";

const investigationService = new InvestigationService();

export const ebpfWebhookRouter = express.Router();

ebpfWebhookRouter.get("/", (_req, res) => {
  const baseUrl = process.env.BASE_URL?.trim() || "http://localhost:8000";
  return res.json({
    ok: true,
    message: "Evolvex eBPF webhook endpoint",
    webhookUrl: `${baseUrl.replace(/\/+$/, "")}/webhooks/ebpf`,
    webhookAuthConfigured: Boolean(process.env.EBPF_WEBHOOK_SECRET?.trim()),
    note: "Per-workspace secrets (Settings → Connect integrations) take priority over this legacy env var.",
  });
});

ebpfWebhookRouter.post("/", async (req, res) => {
  const auth = await requireOrgWebhookAuth(req, res, {
    provider: "ebpf",
    envKey: "EBPF_WEBHOOK_SECRET",
    headerName: "x-evolvex-ebpf-secret",
  });
  if (!auth.ok) return;

  const parsed = ebpfEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid eBPF event payload" });
  }

  try {
    let organizationId = auth.organizationId;
    if (!organizationId) {
      const ownerUserId = await resolveInvestigationOwnerUserId();
      organizationId = await resolveOrganizationForUser(ownerUserId);
    }

    if (organizationId) {
      await recordWebhookSignalEvent({
        organizationId,
        provider: "ebpf",
        summary: `${parsed.data.type} · ${parsed.data.service ?? "unknown service"}`,
      });
    }

    const result = await investigationService.handleEbpfWebhook(parsed.data, { organizationId });
    logger.info("eBPF webhook processed", result);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logger.error("eBPF webhook handler failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: "eBPF webhook processing failed" });
  }
});
