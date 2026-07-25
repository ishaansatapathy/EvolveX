import { z } from "zod";

import { getTelemetryIntelligenceConfig, listActiveSamplingPolicies, buildTelemetryIntelligenceDashboard, buildInvestigationInsights } from "@repo/services/telemetry-intelligence";
import { isSignozConfigured } from "@repo/services/signoz-env";
import { buildCollectorConfigForOrganization } from "@repo/services/telemetry-intelligence/collector/org-config";
import { ensureUserOrganization } from "@repo/services/organization";
import InvestigationService from "@repo/services/investigation";

import { protectedProcedure, router } from "../../trpc";

const TAGS = ["Telemetry Intelligence"];

const policySchema = z.object({
  serviceName: z.string(),
  mode: z.string(),
  sampleRate: z.number(),
  reason: z.string(),
  expiresAt: z.string(),
  triggerSource: z.string().optional(),
});

const dashboardSchema = z.object({
  windowDays: z.number(),
  generatedAt: z.string(),
  intelligenceState: z.enum(["normal", "elevated", "incident", "change_boost"]),
  totals: z.object({
    investigations: z.number(),
    open: z.number(),
    resolved: z.number(),
    failed: z.number(),
  }),
  avgInvestigationMinutes: z.number().nullable(),
  resolutionRatePercent: z.number(),
  activeSamplingPolicies: z.number(),
  incidentProneServices: z.array(
    z.object({
      service: z.string(),
      incidentCount: z.number(),
      openCount: z.number(),
      lastIncidentAt: z.string(),
    }),
  ),
  topAlertCategories: z.array(
    z.object({
      alertName: z.string(),
      count: z.number(),
      primaryService: z.string().nullable(),
    }),
  ),
  frequentRootCauseSignals: z.array(
    z.object({
      signal: z.string(),
      count: z.number(),
    }),
  ),
  recentInvestigations: z.array(
    z.object({
      id: z.string(),
      shortId: z.string(),
      title: z.string(),
      primaryService: z.string().nullable(),
      severity: z.string().nullable(),
      caseStatus: z.string(),
      createdAt: z.string(),
    }),
  ),
});

const clickhouseInsightsSchema = z
  .object({
    enabled: z.literal(true),
    serviceName: z.string(),
    windowMinutes: z.number(),
    source: z.enum(["materialized_view", "native_query", "signoz_api"]),
    materializedViewsAvailable: z.boolean(),
    latencySummary: z
      .object({
        requests: z.number(),
        errors: z.number(),
        p99Ms: z.number().nullable(),
      })
      .nullable(),
    topFailingEndpoints: z.array(
      z.object({
        endpoint: z.string(),
        errorCount: z.number(),
        p99Ms: z.number().nullable(),
      }),
    ),
    queryElapsedMs: z.number().nullable(),
  })
  .nullable();

const investigationService = new InvestigationService();

export const telemetryIntelligenceRouter = router({
  dashboard: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/telemetry-intelligence/dashboard", tags: TAGS } })
    .input(z.object({ windowDays: z.number().min(1).max(365).optional() }).optional())
    .output(dashboardSchema)
    .query(async ({ ctx, input }) => {
      const organization = await ensureUserOrganization(ctx.user.id);
      return buildTelemetryIntelligenceDashboard({
        organizationId: organization.id,
        windowDays: input?.windowDays,
      });
    }),

  insightsForInvestigation: protectedProcedure
    .meta({
      openapi: { method: "GET", path: "/telemetry-intelligence/investigations/{id}/insights", tags: TAGS },
    })
    .input(
      z.object({
        investigationId: z.string().uuid(),
        windowMinutes: z.number().min(1).max(240).optional(),
      }),
    )
    .output(clickhouseInsightsSchema)
    .query(async ({ ctx, input }) => {
      const detail = await investigationService.getById(input.investigationId, ctx.user.id);
      if (!detail) return null;

      const serviceName =
        detail.primaryService ?? detail.affectedServices[0] ?? null;
      if (!serviceName) return null;

      return buildInvestigationInsights({
        serviceName,
        windowMinutes: input.windowMinutes ?? 15,
        endpointLimit: 8,
      });
    }),

  /** @deprecated use insightsForInvestigation */
  clickhouseForInvestigation: protectedProcedure
    .meta({
      openapi: { method: "GET", path: "/telemetry-intelligence/investigations/{id}/clickhouse", tags: TAGS },
    })
    .input(
      z.object({
        investigationId: z.string().uuid(),
        windowMinutes: z.number().min(1).max(240).optional(),
      }),
    )
    .output(clickhouseInsightsSchema)
    .query(async ({ ctx, input }) => {
      const detail = await investigationService.getById(input.investigationId, ctx.user.id);
      if (!detail) return null;

      const serviceName =
        detail.primaryService ?? detail.affectedServices[0] ?? null;
      if (!serviceName) return null;

      return buildInvestigationInsights({
        serviceName,
        windowMinutes: input.windowMinutes ?? 15,
        endpointLimit: 8,
      });
    }),

  status: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/telemetry-intelligence/status", tags: TAGS } })
    .input(z.object({}).optional())
    .output(
      z.object({
        enabled: z.boolean(),
        intelligenceState: z.enum(["normal", "elevated", "incident", "change_boost"]),
        activePolicyCount: z.number(),
        clickhouseEnabled: z.boolean(),
        baselineSampleRate: z.number(),
        elevatedSampleRate: z.number(),
        incidentSampleRate: z.number(),
        changeBoostSampleRate: z.number(),
        collectorConfigUrl: z.string(),
        features: z.array(z.object({ id: z.string(), label: z.string(), status: z.string() })),
        policies: z.array(policySchema),
      }),
    )
    .query(async () => {
      const config = getTelemetryIntelligenceConfig();
      const policies = await listActiveSamplingPolicies();
      const baseUrl = process.env.BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:8000";

      const intelligenceState = policies.some((row) => row.mode === "incident")
        ? "incident"
        : policies.some((row) => row.mode === "change_boost")
          ? "change_boost"
          : policies.some((row) => row.mode === "elevated")
            ? "elevated"
            : "normal";

      return {
        enabled: true,
        intelligenceState,
        activePolicyCount: policies.length,
        clickhouseEnabled: config.clickhouseEnabled,
        baselineSampleRate: config.baselineSampleRate,
        elevatedSampleRate: config.elevatedSampleRate,
        incidentSampleRate: config.incidentSampleRate,
        changeBoostSampleRate: config.changeBoostSampleRate,
        collectorConfigUrl: `${baseUrl}/telemetry-intelligence/collector-config`,
        features: [
          { id: "#1", label: "Adaptive tail sampling", status: "active" },
          { id: "#2", label: "OTel collector enrichment", status: "active" },
          { id: "#3", label: "Alert enrichment pipeline", status: "active" },
          { id: "#4", label: "ClickHouse materialized views", status: config.clickhouseEnabled ? "active" : "self-hosted only" },
          {
            id: "#5",
            label: "Runtime investigation queries",
            status: config.clickhouseEnabled || isSignozConfigured() ? "active" : "optional",
          },
          { id: "#6", label: "Service map deep correlation", status: "active" },
          { id: "#7", label: "Context-aware collection", status: "active" },
          { id: "#8", label: "Change-aware sampling", status: "active" },
          { id: "#9", label: "Investigation vectors", status: "active" },
          { id: "#10", label: "Telemetry intelligence layer", status: "active" },
        ],
        policies: policies.map((row) => ({
          serviceName: row.serviceName,
          mode: row.mode,
          sampleRate: row.sampleRate,
          reason: row.reason,
          expiresAt: row.expiresAt.toISOString(),
          triggerSource: row.triggerSource,
        })),
      };
    }),

  collectorConfig: protectedProcedure
    .meta({
      openapi: { method: "GET", path: "/telemetry-intelligence/collector-config", tags: TAGS },
    })
    .input(z.object({}).optional())
    .output(
      z.object({
        yaml: z.string(),
        activePolicyCount: z.number(),
        signozOtlpEndpoint: z.string(),
        services: z.array(z.string()),
      }),
    )
    .query(async ({ ctx }) => {
      const organization = await ensureUserOrganization(ctx.user.id);
      const result = await buildCollectorConfigForOrganization({
        organizationId: organization.id,
      });
      return {
        yaml: result.yaml,
        activePolicyCount: result.activePolicyCount,
        signozOtlpEndpoint: result.signozOtlpEndpoint,
        services: result.services,
      };
    }),
});
