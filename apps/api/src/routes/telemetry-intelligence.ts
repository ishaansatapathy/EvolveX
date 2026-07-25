import express from "express";
import type { Request, Response } from "express";

import { resolveInvestigationOwnerUserId } from "@repo/services/investigation/owner";
import { resolveOrganizationForUser } from "@repo/services/organization";
import {
  buildCollectorConfigForOrganization,
  listActiveSamplingPolicies,
  mapSamplingPolicyRows,
  verifyCollectorApiKey,
} from "@repo/services/telemetry-intelligence";

export const telemetryIntelligenceRouter = express.Router();

function parseOrganizationId(req: Request) {
  const raw = typeof req.query.organizationId === "string" ? req.query.organizationId.trim() : "";
  return raw || null;
}

function requireCollectorAuth(req: Request, res: Response) {
  const auth = verifyCollectorApiKey(req.headers.authorization);
  if (!auth.authenticated) {
    res.status(401).json({ error: "Unauthorized — set Authorization: Bearer <EVOLVEX_COLLECTOR_KEY>" });
    return false;
  }
  return true;
}

telemetryIntelligenceRouter.get("/status", async (req, res) => {
  if (!requireCollectorAuth(req, res)) return;

  const organizationId = parseOrganizationId(req);
  const policies = await listActiveSamplingPolicies({ organizationId });
  return res.json({
    ok: true,
    enabled: true,
    activePolicyCount: policies.length,
    organizationId,
    policies: policies.map((row) => ({
      serviceName: row.serviceName,
      mode: row.mode,
      sampleRate: row.sampleRate,
      reason: row.reason,
      expiresAt: row.expiresAt.toISOString(),
    })),
  });
});

telemetryIntelligenceRouter.get("/sampling-policies", async (req, res) => {
  if (!requireCollectorAuth(req, res)) return;

  const organizationId = parseOrganizationId(req);
  const policies = await listActiveSamplingPolicies({ organizationId });
  return res.json({
    organizationId,
    policies: mapSamplingPolicyRows(policies).map((policy) => ({
      ...policy,
      expiresAt: policy.expiresAt.toISOString(),
    })),
  });
});

telemetryIntelligenceRouter.get("/collector-config", async (req, res) => {
  if (!requireCollectorAuth(req, res)) return;

  let organizationId = parseOrganizationId(req);
  if (!organizationId) {
    try {
      const ownerUserId = await resolveInvestigationOwnerUserId();
      organizationId = await resolveOrganizationForUser(ownerUserId);
    } catch {
      organizationId = null;
    }
  }

  if (!organizationId) {
    return res.status(400).json({
      error: "organizationId query param required (or set INVESTIGATION_OWNER_EMAIL for auto-resolve)",
    });
  }

  const result = await buildCollectorConfigForOrganization({ organizationId });
  res.setHeader("Content-Type", "text/yaml; charset=utf-8");
  res.setHeader("X-Evolvex-Policy-Count", String(result.activePolicyCount));
  return res.send(result.yaml);
});
