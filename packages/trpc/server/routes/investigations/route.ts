import {
  investigationDetailSchema,
  investigationListItemSchema,
  investigationNoteSchema,
  investigationOsContextSchema,
  timelineEntrySchema,
} from "@repo/services/investigation/types";
import { isOpenAiConfigured } from "@repo/services/ai/openai";
import { isGithubApiConfigured } from "@repo/services/github/api";
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
        kubernetesWebhookUrl: z.string(),
        ebpfWebhookUrl: z.string(),
        cloudUrl: z.string().nullable(),
        productionMode: z.boolean(),
        demoTracesEnabled: z.boolean(),
        defaultServiceName: z.string(),
        ingestionConfigured: z.boolean(),
        openAiConfigured: z.boolean(),
        otelApiEnabled: z.boolean(),
        githubApiConfigured: z.boolean(),
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
        kubernetesWebhookUrl: `${normalizedBase}/webhooks/kubernetes`,
        ebpfWebhookUrl: `${normalizedBase}/webhooks/ebpf`,
        cloudUrl: config?.cloudUrl ?? null,
        productionMode: isProductionEnvironment(),
        demoTracesEnabled: isDemoTracesEnabled(),
        defaultServiceName: getDefaultServiceName(),
        ingestionConfigured: Boolean(process.env.SIGNOZ_INGESTION_KEY?.trim()),
        openAiConfigured: isOpenAiConfigured(),
        otelApiEnabled: Boolean(process.env.SIGNOZ_INGESTION_KEY?.trim()),
        githubApiConfigured: isGithubApiConfigured(),
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
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          query: z.string().max(200).optional(),
          severity: z.string().max(32).optional(),
          pipelineStatus: z.enum(["building", "ready", "failed"]).optional(),
          caseStatus: z.enum(["open", "investigating", "monitoring", "resolved"]).optional(),
        })
        .optional(),
    )
    .output(z.array(investigationListItemSchema))
    .query(async ({ ctx, input }) => {
      try {
        return await investigationService.list(ctx.user.id, input?.limit ?? 50, {
          query: input?.query,
          severity: input?.severity,
          pipelineStatus: input?.pipelineStatus,
          caseStatus: input?.caseStatus,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  similar: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/investigations/{id}/similar", tags: TAGS } })
    .input(z.object({ id: z.string().uuid(), limit: z.number().int().min(1).max(20).optional() }))
    .output(
      z.array(
        investigationListItemSchema.extend({
          similarityScore: z.number(),
          matchReasons: z.array(z.string()),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      try {
        const rows = await investigationService.findSimilarCases(input.id, ctx.user.id, input.limit ?? 5);
        if (!rows) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });
        }
        return rows;
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

  context: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/investigations/{id}/context", tags: TAGS } })
    .input(z.object({ id: z.string().uuid() }))
    .output(investigationOsContextSchema)
    .query(async ({ ctx, input }) => {
      try {
        const context = await investigationService.getOsContext(input.id, ctx.user.id);
        if (!context) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });
        }
        return context;
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

  notes: protectedProcedure
    .input(z.object({ investigationId: z.string().uuid() }))
    .output(z.array(investigationNoteSchema))
    .query(async ({ ctx, input }) => {
      try {
        const notes = await investigationService.listNotes(input.investigationId, ctx.user.id);
        if (!notes) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });
        }
        return notes;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  createNote: protectedProcedure
    .input(z.object({ investigationId: z.string().uuid(), body: z.string().min(1).max(4000) }))
    .output(investigationNoteSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const note = await investigationService.createNote(
          input.investigationId,
          ctx.user.id,
          input.body,
        );
        if (!note) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });
        }
        return note;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  regenerateSummary: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .output(
      z.object({
        markdown: z.string(),
        generatedAt: z.string(),
      }).nullable(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await investigationService.regenerateSummary(input.id, ctx.user.id);
        if (result === null) {
          const context = await investigationService.getOsContext(input.id, ctx.user.id);
          if (!context) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });
          }
          return null;
        }
        return {
          markdown: result.markdown,
          generatedAt: result.generatedAt.toISOString(),
        };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  pinpoint: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .output(
      z
        .object({
          primary: z
            .object({
              file: z.string(),
              line: z.number(),
              column: z.number().optional(),
              confidence: z.enum(["high", "medium", "low"]),
              source: z.enum(["log_stack", "github_diff", "correlated"]),
              evidence: z.string(),
              githubUrl: z.string().optional(),
              repo: z.string().optional(),
              commitSha: z.string().optional(),
            })
            .nullable(),
          candidates: z.array(
            z.object({
              file: z.string(),
              line: z.number(),
              confidence: z.enum(["high", "medium", "low"]),
              source: z.enum(["log_stack", "github_diff", "correlated"]),
              evidence: z.string(),
              githubUrl: z.string().optional(),
            }),
          ),
          deployCorrelation: z
            .object({
              repo: z.string(),
              sha: z.string(),
              message: z.string().optional(),
              url: z.string(),
              changedFiles: z.array(z.string()),
            })
            .nullable(),
          githubApiConfigured: z.boolean(),
        })
        .nullable(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await investigationService.getPinpoint(input.id, ctx.user.id);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  suggestFix: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .output(
      z
        .object({
          explanation: z.string(),
          patch: z.string(),
          file: z.string(),
          generatedAt: z.string(),
          disclaimer: z.string(),
        })
        .nullable(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await investigationService.suggestFix(input.id, ctx.user.id);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  exportPostmortem: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .output(
      z
        .object({
          markdown: z.string(),
          filename: z.string(),
          exportedAt: z.string(),
        })
        .nullable(),
    )
    .query(async ({ ctx, input }) => {
      try {
        const result = await investigationService.exportPostmortem(input.id, ctx.user.id);
        if (!result) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });
        }
        return result;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  updateCaseStatus: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        caseStatus: z.enum(["open", "investigating", "monitoring", "resolved"]),
      }),
    )
    .output(investigationListItemSchema.nullable())
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await investigationService.updateCaseStatus(
          input.id,
          ctx.user.id,
          input.caseStatus,
        );
        if (!result) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });
        }
        return result;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  triggerEbpfEnrichment: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .output(
      z.object({
        added: z.number(),
        message: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await investigationService.triggerEbpfEnrichment(input.id, ctx.user.id);
        if (!result) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });
        }
        return result;
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
