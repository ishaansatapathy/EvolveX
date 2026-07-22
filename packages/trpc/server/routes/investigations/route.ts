import {
  investigationDetailSchema,
  investigationListItemSchema,
  timelineEntrySchema,
} from "@repo/services/investigation/types";
import {
  getSignozConfig,
  getSignozWebhookPublicUrl,
  isProductionEnvironment,
  isSignozConfigured,
  getDefaultServiceName,
} from "@repo/services/signoz-env";
import { isDemoTracesEnabled } from "@repo/services/signoz/demo-traces";
import { signozClient } from "@repo/services/signoz/client";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { investigationService } from "../../services";

const TAGS = ["Investigations"];

const logRowSchema = z.object({
  timestamp: z.string().optional(),
  body: z.string().optional(),
  severityText: z.string().optional(),
  serviceName: z.string().optional(),
  traceId: z.string().optional(),
});

const traceRowSchema = z.object({
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  serviceName: z.string().optional(),
  name: z.string().optional(),
  durationMs: z.number().optional(),
  hasError: z.boolean().optional(),
  timestamp: z.string().optional(),
});

export const investigationsRouter = router({
  signozStatus: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/investigations/signoz-status", tags: TAGS } })
    .input(z.object({}).optional())
    .output(
      z.object({
        apiConfigured: z.boolean(),
        webhookAuthConfigured: z.boolean(),
        webhookUrl: z.string(),
        githubWebhookUrl: z.string(),
        cloudUrl: z.string().nullable(),
        productionMode: z.boolean(),
        demoTracesEnabled: z.boolean(),
        defaultServiceName: z.string(),
        ingestionConfigured: z.boolean(),
      }),
    )
    .query(async () => {
      const config = getSignozConfig();
      const baseUrl = process.env.BASE_URL?.trim() || "http://localhost:8000";
      const normalizedBase = baseUrl.replace(/\/+$/, "");
      return {
        apiConfigured: isSignozConfigured(),
        webhookAuthConfigured: Boolean(config?.webhookSecret),
        webhookUrl: getSignozWebhookPublicUrl(baseUrl),
        githubWebhookUrl: `${normalizedBase}/webhooks/github`,
        cloudUrl: config?.cloudUrl ?? null,
        productionMode: isProductionEnvironment(),
        demoTracesEnabled: isDemoTracesEnabled(),
        defaultServiceName: getDefaultServiceName(),
        ingestionConfigured: Boolean(process.env.SIGNOZ_INGESTION_KEY?.trim()),
      };
    }),

  testSignozConnection: protectedProcedure
    .input(z.object({}).optional())
    .output(z.object({ ok: z.boolean(), message: z.string() }))
    .query(async () => {
      return signozClient.testConnection();
    }),

  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/investigations", tags: TAGS } })
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .output(z.array(investigationListItemSchema))
    .query(async ({ ctx, input }) => {
      try {
        return await investigationService.list(ctx.user.id, input?.limit ?? 50);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  get: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/investigations/{id}", tags: TAGS } })
    .input(z.object({ id: z.string().uuid() }))
    .output(investigationDetailSchema)
    .query(async ({ ctx, input }) => {
      try {
        const row = await investigationService.getById(input.id, ctx.user.id);
        if (!row) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });
        }
        return row;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  timeline: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/investigations/{id}/timeline", tags: TAGS } })
    .input(z.object({ id: z.string().uuid() }))
    .output(z.array(timelineEntrySchema))
    .query(async ({ ctx, input }) => {
      try {
        const timeline = await investigationService.getTimeline(input.id, ctx.user.id);
        if (!timeline) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });
        }
        return timeline;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  logs: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .output(
      z.object({
        logs: z.array(logRowSchema),
        service: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const result = await investigationService.getLogsForInvestigation(input.id, ctx.user.id);
        if (!result) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });
        }
        return result;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  traces: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .output(
      z.object({
        traces: z.array(traceRowSchema),
        service: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const result = await investigationService.getTracesForInvestigation(input.id, ctx.user.id);
        if (!result) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });
        }
        return result;
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
