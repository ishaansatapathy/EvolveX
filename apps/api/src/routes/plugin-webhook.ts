import express from "express";
import { logger } from "@repo/logger";
import InvestigationService from "@repo/services/investigation";
import { resolveInvestigationOwnerUserId } from "@repo/services/investigation/owner";
import { resolveOrganizationForUser } from "@repo/services/organization";
import { PLUGIN_CATALOG, dispatchPluginWebhook, verifyPluginWebhookSecret } from "@repo/services/plugins";

const investigationService = new InvestigationService();

export const pluginWebhookRouter = express.Router();

pluginWebhookRouter.get("/", (_req, res) => {
  const baseUrl = process.env.BASE_URL?.trim() || "http://localhost:8000";
  return res.json({
    ok: true,
    message: "Evolvex plugin webhook ingress · Feature #58",
    catalog: PLUGIN_CATALOG.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      category: plugin.category,
      webhookUrl: `${baseUrl.replace(/\/+$/, "")}/webhooks/plugins/${plugin.id}`,
      docs: plugin.docs,
    })),
  });
});

pluginWebhookRouter.post("/:pluginId", async (req, res) => {
  const pluginId = req.params.pluginId;
  if (!pluginId || !PLUGIN_CATALOG.some((plugin) => plugin.id === pluginId)) {
    return res.status(404).json({ error: "Unknown plugin" });
  }

  const providedSecret =
    (typeof req.headers["x-evolvex-plugin-secret"] === "string"
      ? req.headers["x-evolvex-plugin-secret"]
      : undefined) ??
    (typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice("Bearer ".length)
      : undefined);

  try {
    const ownerUserId = await resolveInvestigationOwnerUserId();
    if (!ownerUserId) {
      return res.status(503).json({ error: "INVESTIGATION_OWNER_EMAIL is not configured" });
    }
    const organizationId = await resolveOrganizationForUser(ownerUserId);
    if (!organizationId) {
      return res.status(503).json({ error: "Organization not found for investigation owner" });
    }

    const verified = await verifyPluginWebhookSecret({
      organizationId,
      pluginId,
      providedSecret,
    });

    if (!verified.ok) {
      const status = verified.reason === "not_installed" ? 404 : 401;
      return res.status(status).json({
        error:
          verified.reason === "not_installed"
            ? "Plugin is not installed for this workspace"
            : "Invalid plugin webhook secret",
      });
    }

    const result = await dispatchPluginWebhook(investigationService, {
      pluginId,
      organizationId,
      payload: req.body,
    });

    logger.info("Plugin webhook processed", result);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    logger.error("Plugin webhook failed", {
      pluginId,
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: "Plugin webhook processing failed" });
  }
});
