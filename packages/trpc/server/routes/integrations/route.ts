import { buildIntegrationHealth } from "@repo/services/integrations/status";
import {
  probeDatabaseConnection,
  probeGithubApiConnection,
  probeOpenAiConnection,
  probeSignozConnection,
} from "@repo/services/integrations/probes";

import { z } from "zod";

import { protectedProcedure, router } from "../../trpc";

const TAGS = ["Integrations"];

const integrationHealthItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  category: z.enum(["telemetry", "ai", "change", "platform"]),
  status: z.enum(["ready", "partial", "missing", "unavailable"]),
  configured: z.boolean(),
  authConfigured: z.boolean(),
  connected: z.boolean().nullable(),
  detail: z.string(),
  webhookUrl: z.string().nullable(),
  actionLabel: z.string().nullable(),
});

const integrationHealthSchema = z.object({
  readyCount: z.number(),
  partialCount: z.number(),
  missingCount: z.number(),
  totalCount: z.number(),
  summary: z.string(),
  productionMode: z.boolean(),
  baseUrl: z.string(),
  cloudUrl: z.string().nullable(),
  defaultServiceName: z.string(),
  integrations: z.array(integrationHealthItemSchema),
});

const probeResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});

export const integrationsRouter = router({
  health: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/integrations/health", tags: TAGS } })
    .input(z.object({}).optional())
    .output(integrationHealthSchema)
    .query(async () => {
      let databaseConnected: boolean | null = null;

      try {
        const probe = await probeDatabaseConnection();
        databaseConnected = probe.ok;
      } catch {
        databaseConnected = false;
      }

      return buildIntegrationHealth({ databaseConnected });
    }),

  testSignoz: protectedProcedure
    .input(z.object({}).optional())
    .output(probeResultSchema)
    .query(async () => probeSignozConnection()),

  testDatabase: protectedProcedure
    .input(z.object({}).optional())
    .output(probeResultSchema)
    .query(async () => probeDatabaseConnection()),

  testGithub: protectedProcedure
    .input(z.object({}).optional())
    .output(probeResultSchema)
    .query(async () => probeGithubApiConnection()),

  testOpenAi: protectedProcedure
    .input(z.object({}).optional())
    .output(probeResultSchema)
    .query(async () => probeOpenAiConnection()),
});
