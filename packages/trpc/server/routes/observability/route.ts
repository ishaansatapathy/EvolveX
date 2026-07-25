import { z } from "zod";
import { getSharedCounters } from "@repo/services/observability/counters";
import { buildDeepHealthSnapshot } from "@repo/services/observability/deep-health";
import { buildSelfObservabilitySnapshot } from "@repo/services/observability/self";
import { runBenchmarkSuite } from "@repo/services/benchmarks/suite";
import { buildPerformanceMetricsSnapshot } from "@repo/services/performance/metrics";
import { runDeployCheck } from "@repo/services/deploy/check";
import { validateDeployEnvironment } from "@repo/services/deploy/preflight";
import { ensureUserOrganization } from "@repo/services/organization";

import { protectedProcedure, router } from "../../trpc";

const productionFeaturesSchema = z.array(
  z.object({ id: z.string(), label: z.string(), status: z.string() }),
);

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

  self: protectedProcedure
    .input(z.object({}).optional())
    .output(
      z.object({
        generatedAt: z.string(),
        serviceName: z.string(),
        otel: z.object({
          enabled: z.boolean(),
          sdkDisabled: z.boolean(),
          ingestionConfigured: z.boolean(),
          serviceName: z.string(),
          deploymentEnvironment: z.string(),
          ingestionUrl: z.string().nullable(),
        }),
        traceExplorerUrl: z.string().nullable(),
        counters: z.record(z.string(), z.number()),
        counterHighlights: z.array(
          z.object({
            name: z.string(),
            label: z.string(),
            value: z.number(),
          }),
        ),
        rateLimiting: z.object({
          enabled: z.boolean(),
          backend: z.enum(["redis", "in-process"]),
          notes: z.array(z.string()),
        }),
        security: z.object({
          productionMode: z.boolean(),
          helmetEnabled: z.literal(true),
          jwtConfigured: z.boolean(),
          webhookSecretsConfigured: z.boolean(),
          skipEnvValidation: z.boolean(),
        }),
        notes: z.array(z.string()),
      }),
    )
    .query(async () => buildSelfObservabilitySnapshot()),

  deepHealth: protectedProcedure
    .input(z.object({}).optional())
    .output(
      z.object({
        generatedAt: z.string(),
        healthy: z.boolean(),
        environment: z.string(),
        checks: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            ok: z.boolean(),
            message: z.string(),
          }),
        ),
      }),
    )
    .query(async () => buildDeepHealthSnapshot()),

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

  deployPreflight: protectedProcedure
    .input(z.object({}).optional())
    .output(
      z.object({
        environment: z.enum(["development", "staging", "production"]),
        ok: z.boolean(),
        errors: z.array(
          z.object({
            level: z.enum(["error", "warning"]),
            field: z.string(),
            message: z.string(),
          }),
        ),
        warnings: z.array(
          z.object({
            level: z.enum(["error", "warning"]),
            field: z.string(),
            message: z.string(),
          }),
        ),
        summary: z.string(),
      }),
    )
    .query(async () => validateDeployEnvironment()),

  deployCheck: protectedProcedure
    .input(z.object({ baseUrl: z.string().url().optional() }).optional())
    .output(
      z.object({
        generatedAt: z.string(),
        ok: z.boolean(),
        summary: z.string(),
        preflight: z.object({
          environment: z.enum(["development", "staging", "production"]),
          ok: z.boolean(),
          summary: z.string(),
        }),
        smoke: z
          .object({
            ok: z.boolean(),
            summary: z.string(),
            baseUrl: z.string(),
            checks: z.array(
              z.object({
                name: z.string(),
                ok: z.boolean(),
                message: z.string(),
                durationMs: z.number(),
              }),
            ),
          })
          .nullable(),
      }),
    )
    .query(async ({ input }) => {
      const result = await runDeployCheck({
        baseUrl: input?.baseUrl ?? process.env.BASE_URL ?? null,
      });
      return {
        generatedAt: result.generatedAt,
        ok: result.ok,
        summary: result.summary,
        preflight: {
          environment: result.preflight.environment,
          ok: result.preflight.ok,
          summary: result.preflight.summary,
        },
        smoke: result.smoke
          ? {
              ok: result.smoke.ok,
              summary: result.smoke.summary,
              baseUrl: result.smoke.baseUrl,
              checks: result.smoke.checks.map((check) => ({
                name: check.name,
                ok: check.ok,
                message: check.message,
                durationMs: check.durationMs,
              })),
            }
          : null,
      };
    }),

  productionFeatures: protectedProcedure
    .input(z.object({}).optional())
    .output(productionFeaturesSchema)
    .query(async () => {
      const self = await buildSelfObservabilitySnapshot();
      const preflight = validateDeployEnvironment();

      return [
        { id: "#37", label: "Deep health checks", status: "active" },
        { id: "#38", label: "Rate limiting", status: self.rateLimiting.enabled ? "active" : "disabled" },
        { id: "#39", label: "Self-observability", status: self.otel.enabled ? "active" : "configure SIGNOZ_INGESTION_KEY" },
        { id: "#40", label: "Distributed tracing", status: self.otel.enabled ? "active" : "optional" },
        { id: "#41", label: "Benchmark suite", status: "active" },
        { id: "#42", label: "Performance metrics", status: "active" },
        { id: "#43", label: "Architecture decision records", status: "active" },
        { id: "#44", label: "Security hardening", status: self.security.jwtConfigured ? "active" : "partial" },
        {
          id: "#45",
          label: "Deploy automation",
          status: preflight.ok ? "active" : "needs env fixes",
        },
      ];
    }),
});
