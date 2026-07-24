import express from "express";
import { logger } from "@repo/logger";
import InvestigationService from "@repo/services/investigation";
import { resolveInvestigationOwnerUserId } from "@repo/services/investigation/owner";
import { resolveOrganizationForUser } from "@repo/services/organization";
import {
  sdkCustomEventSchema,
  sdkMetadataSchema,
  sdkTimelineEventSchema,
} from "@repo/services/sdk";

import { requireEvolvexApiKey } from "../middleware/api-key-auth";

const investigationService = new InvestigationService();

export const sdkApiRouter = express.Router();

sdkApiRouter.use(requireEvolvexApiKey);

async function resolveSdkScope() {
  const ownerUserId = await resolveInvestigationOwnerUserId();
  if (!ownerUserId) {
    throw new Error("INVESTIGATION_OWNER_EMAIL is not configured");
  }
  const organizationId = await resolveOrganizationForUser(ownerUserId);
  if (!organizationId) {
    throw new Error("Organization not found for investigation owner");
  }
  return { ownerUserId, organizationId };
}

sdkApiRouter.get("/", (_req, res) => {
  const baseUrl = process.env.BASE_URL?.trim() || "http://localhost:8000";
  return res.json({
    ok: true,
    message: "Evolvex SDK API · Feature #57",
    version: "1.0.0",
    baseUrl: `${baseUrl.replace(/\/+$/, "")}/api/v1/sdk`,
    endpoints: [
      "GET /investigations",
      "GET /investigations/:id",
      "GET /investigations/:id/timeline",
      "POST /investigations/:id/timeline-events",
      "POST /investigations/:id/metadata",
      "POST /events",
    ],
  });
});

sdkApiRouter.get("/investigations", async (req, res) => {
  try {
    const { ownerUserId } = await resolveSdkScope();
    const limit = Math.min(Number(req.query.limit ?? 50), 100);
    const rows = await investigationService.list(ownerUserId, limit, {
      query: typeof req.query.query === "string" ? req.query.query : undefined,
      severity: typeof req.query.severity === "string" ? req.query.severity : undefined,
      service: typeof req.query.service === "string" ? req.query.service : undefined,
    });
    return res.json({ ok: true, investigations: rows });
  } catch (error) {
    logger.error("SDK list investigations failed", { message: error instanceof Error ? error.message : String(error) });
    return res.status(500).json({ error: "Failed to list investigations" });
  }
});

sdkApiRouter.get("/investigations/:id", async (req, res) => {
  try {
    const { ownerUserId } = await resolveSdkScope();
    const row = await investigationService.getById(req.params.id!, ownerUserId);
    if (!row) return res.status(404).json({ error: "Investigation not found" });
    return res.json({ ok: true, investigation: row });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch investigation" });
  }
});

sdkApiRouter.get("/investigations/:id/timeline", async (req, res) => {
  try {
    const { ownerUserId } = await resolveSdkScope();
    const timeline = await investigationService.getTimeline(req.params.id!, ownerUserId);
    if (!timeline) return res.status(404).json({ error: "Investigation not found" });
    return res.json({ ok: true, timeline });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch timeline" });
  }
});

sdkApiRouter.post("/investigations/:id/timeline-events", async (req, res) => {
  const parsed = sdkTimelineEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid timeline event payload", details: parsed.error.flatten() });
  }

  try {
    const { organizationId } = await resolveSdkScope();
    const entry = await investigationService.attachSdkTimelineEvent(req.params.id!, parsed.data, organizationId);
    if (!entry) return res.status(404).json({ error: "Investigation not found" });
    return res.status(201).json({ ok: true, timelineEntryId: entry.id });
  } catch (error) {
    return res.status(500).json({ error: "Failed to create timeline event" });
  }
});

sdkApiRouter.post("/investigations/:id/metadata", async (req, res) => {
  const parsed = sdkMetadataSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid metadata payload", details: parsed.error.flatten() });
  }

  try {
    const { organizationId } = await resolveSdkScope();
    const result = await investigationService.attachSdkMetadata(req.params.id!, parsed.data, organizationId);
    if (!result) return res.status(404).json({ error: "Investigation not found" });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({ error: "Failed to attach metadata" });
  }
});

sdkApiRouter.post("/events", async (req, res) => {
  const parsed = sdkCustomEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid custom event payload", details: parsed.error.flatten() });
  }

  try {
    const { organizationId } = await resolveSdkScope();
    const result = await investigationService.handleSdkCustomEvent(parsed.data, {
      organizationId,
      source: parsed.data.source ?? "sdk",
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    logger.error("SDK custom event failed", { message: error instanceof Error ? error.message : String(error) });
    return res.status(500).json({ error: "Failed to push custom event" });
  }
});
