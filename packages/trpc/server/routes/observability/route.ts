import { z } from "zod";
import { getSharedCounters } from "@repo/services/observability/counters";
import { runBenchmarkSuite } from "@repo/services/benchmarks/suite";
import { buildPerformanceMetricsSnapshot } from "@repo/services/performance/metrics";
import { ensureUserOrganization } from "@repo/services/organization";

import { protectedProcedure, router } from "../../trpc";

export const observabilityRouter = router({
  summary: protectedProcedure
    .input(z.object({}).optional())
    .output(
      z.object({
        counters: z.record(z.string(), z.number().int()),
        inboxCacheHits: z.number().int(),
        mcpToolCalls: z.number().int(),
      }),
    )
    .query(async () => {
      const counters = getSharedCounters();
      const mcpToolCalls = Object.entries(counters)
        .filter(([key]) => key.startsWith("mcp.tool."))
        .reduce((sum, [, value]) => sum + value, 0);

      return {
        counters,
        inboxCacheHits: counters["inbox.cache_hit"] ?? 0,
        mcpToolCalls,
      };
    }),

  benchmarks: protectedProcedure
    .input(z.object({}).optional())
    .output(
      z.object({
        generatedAt: z.string(),
        environment: z.string(),
        summary: z.string(),
        results: z.array(
          z.object({
            name: z.string(),
            durationMs: z.number(),
            notes: z.string().optional(),
          }),
        ),
      }),
    )
    .query(async () => runBenchmarkSuite()),

  performance: protectedProcedure
    .input(z.object({ windowDays: z.number().min(1).max(365).optional() }).optional())
    .output(
      z.object({
        generatedAt: z.string(),
        windowDays: z.number(),
        investigations: z.object({
          total: z.number(),
          ready: z.number(),
          building: z.number(),
          failed: z.number(),
          avgBuildMinutes: z.number().nullable(),
          p95BuildMinutes: z.number().nullable(),
        }),
        cache: z.object({
          enabled: z.literal(true),
          ttlMs: z.number(),
          rows: z.number(),
          validRows: z.number(),
          hitRateEstimatePercent: z.number().nullable(),
        }),
        summaries: z.object({
          total: z.number(),
          lastGeneratedAt: z.string().nullable(),
        }),
        notes: z.array(z.string()),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organization = await ensureUserOrganization(ctx.user.id);
      return buildPerformanceMetricsSnapshot({
        organizationId: organization.id,
        windowDays: input?.windowDays,
      });
    }),
});
