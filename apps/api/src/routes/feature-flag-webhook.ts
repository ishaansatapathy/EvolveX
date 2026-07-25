import express from "express";
import { logger } from "@repo/logger";
import InvestigationService from "@repo/services/investigation";
import { featureFlagEventSchema, parseFeatureFlagEvent } from "@repo/services/feature-flags/webhook-parser";
import { requireOrgWebhookAuth } from "@repo/services/webhooks/verify";
import { recordWebhookSignalEvent } from "@repo/services/organization/integrations";

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
    note: "Per-workspace secrets (Settings → Connect integrations) take priority over this legacy env var.",
  });
});

featureFlagWebhookRouter.post("/", async (req, res) => {
  const auth = await requireOrgWebhookAuth(req, res, {
    provider: "feature_flag",
    envKey: "FEATURE_FLAG_WEBHOOK_SECRET",
    headerName: "x-evolvex-flag-secret",
  });
  if (!auth.ok) return;

  const parsed = featureFlagEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid feature flag event payload" });
  }

  try {
    let organizationId = auth.organizationId;
    if (!organizationId) {
      const ownerUserId = await resolveInvestigationOwnerUserId();
      organizationId = await resolveOrganizationForUser(ownerUserId);
    }

    if (organizationId) {
      const flagEvent = parseFeatureFlagEvent(parsed.data);
      await recordWebhookSignalEvent({
        organizationId,
        provider: "feature_flag",
        summary: `${flagEvent.flagName} ${flagEvent.action}`,
      });
    }

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
