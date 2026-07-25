import express from "express";
import { logger } from "@repo/logger";
import InvestigationService from "@repo/services/investigation";
import { cicdEventSchema, parseCicdEvent } from "@repo/services/cicd/webhook-parser";
import { requireOrgWebhookAuth } from "@repo/services/webhooks/verify";
import { recordWebhookSignalEvent } from "@repo/services/organization/integrations";

import { resolveInvestigationOwnerUserId } from "@repo/services/investigation/owner";
import { resolveOrganizationForUser } from "@repo/services/organization";

const investigationService = new InvestigationService();

export const cicdWebhookRouter = express.Router();

cicdWebhookRouter.get("/", (_req, res) => {
  const baseUrl = process.env.BASE_URL?.trim() || "http://localhost:8000";
  return res.json({
    ok: true,
    message: "Evolvex CI/CD webhook endpoint",
    webhookUrl: `${baseUrl.replace(/\/+$/, "")}/webhooks/cicd`,
    webhookAuthConfigured: Boolean(process.env.CICD_WEBHOOK_SECRET?.trim()),
    supportedProviders: ["github_actions", "circleci", "jenkins", "gitlab", "generic"],
    stages: ["build", "test", "docker", "release", "deploy", "rollback"],
    note: "Per-workspace secrets (Settings → Connect integrations) take priority over this legacy env var.",
  });
});

cicdWebhookRouter.post("/", async (req, res) => {
  const auth = await requireOrgWebhookAuth(req, res, {
    provider: "cicd",
    envKey: "CICD_WEBHOOK_SECRET",
    headerName: "x-evolvex-cicd-secret",
  });
  if (!auth.ok) return;

  const parsed = cicdEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid CI/CD event payload" });
  }

  try {
    let organizationId = auth.organizationId;
    if (!organizationId) {
      const ownerUserId = await resolveInvestigationOwnerUserId();
      organizationId = await resolveOrganizationForUser(ownerUserId);
    }

    if (organizationId) {
      const cicdEvent = parseCicdEvent(parsed.data);
      await recordWebhookSignalEvent({
        organizationId,
        provider: "cicd",
        summary: `${cicdEvent.jobName} · ${cicdEvent.stage} ${cicdEvent.status}`,
      });
    }

    const result = await investigationService.handleCicdWebhook(parsed.data, { organizationId });
    logger.info("CI/CD webhook processed", result);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logger.error("CI/CD webhook handler failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: "CI/CD webhook processing failed" });
  }
});
