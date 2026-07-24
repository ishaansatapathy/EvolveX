import express from "express";
import { logger } from "@repo/logger";
import InvestigationService from "@repo/services/investigation";
import { featureFlagEventSchema } from "@repo/services/feature-flags/webhook-parser";
import { requireWebhookSecret } from "@repo/services/webhooks/verify";

import { resolveInvestigationOwnerUserId } from "@repo/services/investigation/owner";
import { resolveOrganizationForUser } from "@repo/services/organization";

const investigationService = new InvestigationService();

export const featureFlagWebhookRouter = express.Router();

featureFlagWebhookRouter.get("/", (_req, res) => {
  const baseUrl = process.env.BASE_URL?.trim() || "http://localhost:8000";
  return res.json({
    ok: true,
    message: "Evolvex feature flag webhook endpoint",
    webhookUrl: `${baseUrl.replace(/\/+$/, "")}/webhooks/feature-flags`,
    webhookAuthConfigured: Boolean(process.env.FEATURE_FLAG_WEBHOOK_SECRET?.trim()),
    supportedProviders: ["launchdarkly", "flagsmith", "openfeature", "generic"],
  });
});

featureFlagWebhookRouter.post("/", async (req, res) => {
  if (!requireWebhookSecret(req, res, "FEATURE_FLAG_WEBHOOK_SECRET", "x-evolvex-flag-secret")) return;

  const parsed = featureFlagEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid feature flag event payload" });
  }

  try {
    const ownerUserId = await resolveInvestigationOwnerUserId();
    const organizationId = await resolveOrganizationForUser(ownerUserId);
    const result = await investigationService.handleFeatureFlagWebhook(parsed.data, { organizationId });
    logger.info("Feature flag webhook processed", result);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logger.error("Feature flag webhook handler failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: "Feature flag webhook processing failed" });
  }
});
