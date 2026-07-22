import {
  investigationDetailSchema,
  investigationListItemSchema,
  timelineEntrySchema,
} from "@repo/services/investigation/types";
import { getSignozConfig, getSignozWebhookPublicUrl, isProductionEnvironment, isSignozConfigured, getDefaultServiceName } from "@repo/services/signoz-env";
import { isDemoTracesEnabled } from "@repo/services/signoz/demo-traces";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { investigationService } from "../../services";

const TAGS = ["Investigations"];

export const investigationsRouter = router({
  signozStatus: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/investigations/signoz-status", tags: TAGS } })
    .input(z.object({}).optional())
    .output(
      z.object({
        apiConfigured: z.boolean(),
        webhookAuthConfigured: z.boolean(),
        webhookUrl: z.string(),
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
      return {
        apiConfigured: isSignozConfigured(),
        webhookAuthConfigured: Boolean(config?.webhookSecret),
        webhookUrl: getSignozWebhookPublicUrl(baseUrl),
        cloudUrl: config?.cloudUrl ?? null,
        productionMode: isProductionEnvironment(),
        demoTracesEnabled: isDemoTracesEnabled(),
        defaultServiceName: getDefaultServiceName(),
        ingestionConfigured: Boolean(process.env.SIGNOZ_INGESTION_KEY?.trim()),
      };
    }),

  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/investigations", tags: TAGS } })
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .output(z.array(investigationListItemSchema))
    .query(async ({ input }) => {
      try {
        return await investigationService.list(input?.limit ?? 50);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  get: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/investigations/{id}", tags: TAGS } })
    .input(z.object({ id: z.string().uuid() }))
    .output(investigationDetailSchema)
    .query(async ({ input }) => {
      try {
        const row = await investigationService.getById(input.id);
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
    .query(async ({ input }) => {
      try {
        const exists = await investigationService.getById(input.id);
        if (!exists) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });
        }
        return await investigationService.getTimeline(input.id);
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
