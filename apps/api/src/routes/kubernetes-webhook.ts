import express from "express";
import { logger } from "@repo/logger";
import InvestigationService from "@repo/services/investigation";
import { kubernetesEventSchema, parseKubernetesEvent } from "@repo/services/kubernetes/webhook-parser";
import { recordKubernetesClusterHeartbeat } from "@repo/services/organization/integrations";
import { requireKubernetesWebhookAuth } from "@repo/services/webhooks/kubernetes-auth";

import { resolveInvestigationOwnerUserId } from "@repo/services/investigation/owner";
import { resolveOrganizationForUser } from "@repo/services/organization";

const investigationService = new InvestigationService();

export const kubernetesWebhookRouter = express.Router();

kubernetesWebhookRouter.get("/", (_req, res) => {
  const baseUrl = process.env.BASE_URL?.trim() || "http://localhost:8000";
  return res.json({
    ok: true,
    message: "Evolvex Kubernetes webhook endpoint",
    webhookUrl: `${baseUrl.replace(/\/+$/, "")}/webhooks/kubernetes`,
    webhookAuthConfigured: Boolean(process.env.KUBERNETES_WEBHOOK_SECRET?.trim()),
    helmChart: "./helm/evolvex-agent",
  });
});

kubernetesWebhookRouter.post("/", async (req, res) => {
  const auth = await requireKubernetesWebhookAuth(req, res);
  if (!auth.ok) return;

  const parsed = kubernetesEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Kubernetes event payload" });
  }

  try {
    let organizationId = auth.organizationId;
    if (!organizationId) {
      const ownerUserId = await resolveInvestigationOwnerUserId();
      organizationId = await resolveOrganizationForUser(ownerUserId);
    }

    if (organizationId) {
      const event = parseKubernetesEvent(parsed.data);
      await recordKubernetesClusterHeartbeat({
        organizationId,
        metadata: {
          namespaces: event.namespace ? [event.namespace] : undefined,
          lastEventKind: event.reason,
          lastEventNamespace: event.namespace,
        },
      });
    }

    const result = await investigationService.handleKubernetesWebhook(parsed.data, { organizationId });
    logger.info("Kubernetes webhook processed", result);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logger.error("Kubernetes webhook handler failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: "Kubernetes webhook processing failed" });
  }
});
