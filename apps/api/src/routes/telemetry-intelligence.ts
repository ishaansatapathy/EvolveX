import express from "express";
import type { Request, Response } from "express";

import { listActiveSamplingPolicies } from "@repo/services/telemetry-intelligence";
import { generateCollectorConfig } from "@repo/services/telemetry-intelligence";

export const telemetryIntelligenceRouter = express.Router();

telemetryIntelligenceRouter.get("/status", async (_req, res) => {
  const policies = await listActiveSamplingPolicies();
  return res.json({
    ok: true,
    enabled: true,
    activePolicyCount: policies.length,
    policies: policies.map((row) => ({
      serviceName: row.serviceName,
      mode: row.mode,
      sampleRate: row.sampleRate,
      reason: row.reason,
      expiresAt: row.expiresAt.toISOString(),
    })),
  });
});

telemetryIntelligenceRouter.get("/sampling-policies", async (_req, res) => {
  const policies = await listActiveSamplingPolicies();
  return res.json({ policies });
});

telemetryIntelligenceRouter.get("/collector-config", (_req, res) => {
  const evolvexApiUrl = process.env.BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:8000";
  const yaml = generateCollectorConfig({
    evolvexApiUrl,
    signozOtlpEndpoint: process.env.SIGNOZ_OTLP_ENDPOINT ?? "ingest.signoz.cloud:4317",
    signozIngestionKey: process.env.SIGNOZ_INGESTION_KEY,
  });

  res.setHeader("Content-Type", "text/yaml; charset=utf-8");
  return res.send(yaml);
});
