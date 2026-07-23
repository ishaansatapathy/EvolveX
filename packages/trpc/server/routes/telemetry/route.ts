import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { isSignozConfigured } from "@repo/services/signoz-env";
import {
  queryRecentLogs,
  queryRecentTraces,
  queryServiceMap,
  queryServiceMetrics,
  type TelemetryRange,
} from "@repo/services/signoz/telemetry";
import { computeLiveTraceStats } from "@repo/services/signoz/live-stats";

import { mapServiceError, protectedProcedure, router } from "../../trpc";

const TAGS = ["Telemetry"];

const rangeSchema = z.enum(["15m", "1h", "6h"]).default("15m");

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

function requireSignoz() {
  if (!isSignozConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "SigNoz is not configured. Add SIGNOZ_CLOUD_URL and SIGNOZ_API_KEY.",
    });
  }
}

export const telemetryRouter = router({
  status: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/telemetry/status", tags: TAGS } })
    .input(z.object({}).optional())
    .output(z.object({ configured: z.boolean() }))
    .query(() => ({ configured: isSignozConfigured() })),

  traces: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/telemetry/traces", tags: TAGS } })
    .input(
      z.object({
        serviceName: z.string().optional(),
        range: rangeSchema.optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .output(z.object({ traces: z.array(traceRowSchema), range: rangeSchema }))
    .query(async ({ input }) => {
      try {
        requireSignoz();
        const range = (input.range ?? "15m") as TelemetryRange;
        const traces = await queryRecentTraces({
          serviceName: input.serviceName,
          range,
          limit: input.limit,
        });
        return { traces, range };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  logs: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/telemetry/logs", tags: TAGS } })
    .input(
      z.object({
        serviceName: z.string().optional(),
        range: rangeSchema.optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .output(z.object({ logs: z.array(logRowSchema), range: rangeSchema }))
    .query(async ({ input }) => {
      try {
        requireSignoz();
        const range = (input.range ?? "15m") as TelemetryRange;
        const logs = await queryRecentLogs({
          serviceName: input.serviceName,
          range,
          limit: input.limit,
        });
        return { logs, range };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  serviceMap: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/telemetry/service-map", tags: TAGS } })
    .input(z.object({ serviceName: z.string().optional() }).optional())
    .output(
      z.object({
        services: z.array(
          z.object({
            name: z.string(),
            healthy: z.boolean(),
            latencyMs: z.number().nullable(),
          }),
        ),
        edges: z.array(
          z.object({
            source: z.string(),
            destination: z.string(),
            healthy: z.boolean(),
            latencyMs: z.number().nullable(),
          }),
        ),
      }),
    )
    .query(async ({ input }) => {
      try {
        requireSignoz();
        return queryServiceMap({ serviceName: input?.serviceName });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  serviceMetrics: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/telemetry/service-metrics", tags: TAGS } })
    .input(z.object({ range: rangeSchema.optional() }).optional())
    .output(
      z.array(
        z.object({
          serviceName: z.string(),
          p99Ms: z.number().nullable(),
          healthy: z.boolean(),
          queriedAt: z.string(),
          range: rangeSchema,
        }),
      ),
    )
    .query(async ({ input }) => {
      try {
        requireSignoz();
        const range = (input?.range ?? "1h") as TelemetryRange;
        return queryServiceMetrics(range);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  liveStats: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/telemetry/live-stats", tags: TAGS } })
    .input(
      z.object({
        serviceName: z.string().optional(),
        range: rangeSchema.optional(),
      }).optional(),
    )
    .output(
      z.object({
        total: z.number(),
        errors: z.number(),
        slow: z.number(),
        byService: z.array(z.object({ service: z.string(), count: z.number() })),
        evolvexApiCount: z.number(),
        evolvexWebCount: z.number(),
        queriedAt: z.string(),
        range: rangeSchema,
      }),
    )
    .query(async ({ input }) => {
      try {
        requireSignoz();
        const range = (input?.range ?? "15m") as TelemetryRange;
        const traces = await queryRecentTraces({
          serviceName: input?.serviceName,
          range,
          limit: 100,
        });
        return { ...computeLiveTraceStats(traces), range };
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
