import { z } from "zod";

import {
  listOrganizationIntegrations,
  removeOrganizationIntegration,
  testGithubIntegration,
  testJiraIntegration,
  testPagerDutyIntegration,
  testSignozIntegration,
  testSlackIntegration,
  upsertGithubIntegration,
  upsertJiraIntegration,
  upsertPagerDutyIntegration,
  upsertSignozIntegration,
  upsertSlackIntegration,
  generateKubernetesOnboarding,
  generateWebhookSignalOnboarding,
  type WebhookSignalProvider,
} from "@repo/services/organization/integrations";
import { ensureUserOrganization, updateOrganization } from "@repo/services/organization";

import { mapServiceError, protectedProcedure, router } from "../../trpc";

const TAGS = ["Organizations"];

const INTEGRATION_PROVIDER_VALUES = [
  "signoz",
  "github",
  "slack",
  "pagerduty",
  "jira",
  "kubernetes",
  "ebpf",
  "feature_flag",
  "cicd",
] as const;

const webhookSignalProviderSchema = z.enum(["ebpf", "feature_flag", "cicd"]);

const integrationSummarySchema = z.object({
  provider: z.enum(INTEGRATION_PROVIDER_VALUES),
  configured: z.boolean(),
  source: z.enum(["organization", "environment"]),
  config: z.record(z.string(), z.unknown()),
  maskedSecrets: z.record(z.string(), z.string().nullable()),
  updatedAt: z.string().nullable(),
});

const probeResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});

export const organizationsRouter = router({
  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/organizations", tags: TAGS } })
    .input(z.object({}).optional())
    .output(
      z.array(
        z.object({
          id: z.string().uuid(),
          name: z.string(),
          slug: z.string(),
          role: z.enum(["owner", "member"]),
        }),
      ),
    )
    .query(async ({ ctx }) => {
      const { listUserOrganizations } = await import("@repo/services/organization");
      return listUserOrganizations(ctx.user.id);
    }),

  update: protectedProcedure
    .meta({ openapi: { method: "PATCH", path: "/organizations/{organizationId}", tags: TAGS } })
    .input(
      z.object({
        organizationId: z.string().uuid(),
        name: z.string().min(2).max(128),
      }),
    )
    .output(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        slug: z.string(),
        role: z.enum(["owner", "member"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return updateOrganization(ctx.user.id, input.organizationId, { name: input.name });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  integrations: router({
    list: protectedProcedure
      .meta({ openapi: { method: "GET", path: "/organizations/integrations", tags: TAGS } })
      .input(z.object({ organizationId: z.string().uuid().optional() }).optional())
      .output(z.array(integrationSummarySchema))
      .query(async ({ ctx, input }) => {
        try {
          const organization = input?.organizationId
            ? { id: input.organizationId }
            : await ensureUserOrganization(ctx.user.id);
          return listOrganizationIntegrations(ctx.user.id, organization.id);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    upsertSignoz: protectedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid().optional(),
          cloudUrl: z.string().url(),
          apiKey: z.string().max(512).optional(),
          webhookSecret: z.string().max(512).optional(),
          webhookPublicUrl: z.string().max(512).optional(),
          defaultServiceName: z.string().max(128).optional(),
          ingestionKey: z.string().max(512).optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const organization = input.organizationId
            ? { id: input.organizationId }
            : await ensureUserOrganization(ctx.user.id);
          await upsertSignozIntegration(ctx.user.id, organization.id, input);
          return { ok: true as const };
        } catch (error) {
          mapServiceError(error);
        }
      }),

    upsertGithub: protectedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid().optional(),
          token: z.string().max(512).optional(),
          webhookSecret: z.string().max(512).optional(),
          repositoryFullName: z.string().max(256).optional(),
          registerWebhook: z.boolean().optional(),
        }),
      )
      .output(
        z.object({
          ok: z.literal(true),
          webhookRegistration: z
            .object({
              ok: z.boolean(),
              message: z.string(),
              hookId: z.number().optional(),
              action: z.enum(["created", "updated", "existing"]).optional(),
            })
            .nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const organization = input.organizationId
            ? { id: input.organizationId }
            : await ensureUserOrganization(ctx.user.id);
          const webhookRegistration = await upsertGithubIntegration(ctx.user.id, organization.id, input);
          return { ok: true as const, webhookRegistration };
        } catch (error) {
          mapServiceError(error);
        }
      }),

    upsertSlack: protectedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid().optional(),
          webhookUrl: z.string().url().optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const organization = input.organizationId
            ? { id: input.organizationId }
            : await ensureUserOrganization(ctx.user.id);
          await upsertSlackIntegration(ctx.user.id, organization.id, input);
          return { ok: true as const };
        } catch (error) {
          mapServiceError(error);
        }
      }),

    upsertPagerDuty: protectedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid().optional(),
          routingKey: z.string().max(512).optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const organization = input.organizationId
            ? { id: input.organizationId }
            : await ensureUserOrganization(ctx.user.id);
          await upsertPagerDutyIntegration(ctx.user.id, organization.id, input);
          return { ok: true as const };
        } catch (error) {
          mapServiceError(error);
        }
      }),

    upsertJira: protectedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid().optional(),
          baseUrl: z.string().url(),
          email: z.string().email().max(256).optional(),
          apiToken: z.string().max(512).optional(),
          projectKey: z.string().max(32).optional(),
          issueType: z.string().max(64).optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const organization = input.organizationId
            ? { id: input.organizationId }
            : await ensureUserOrganization(ctx.user.id);
          await upsertJiraIntegration(ctx.user.id, organization.id, input);
          return { ok: true as const };
        } catch (error) {
          mapServiceError(error);
        }
      }),

    remove: protectedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid().optional(),
          provider: z.enum(INTEGRATION_PROVIDER_VALUES),
        }),
      )
      .output(z.object({ ok: z.literal(true) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const organization = input.organizationId
            ? { id: input.organizationId }
            : await ensureUserOrganization(ctx.user.id);
          await removeOrganizationIntegration(ctx.user.id, organization.id, input.provider);
          return { ok: true as const };
        } catch (error) {
          mapServiceError(error);
        }
      }),

    testSignoz: protectedProcedure
      .input(z.object({ organizationId: z.string().uuid().optional() }).optional())
      .output(probeResultSchema)
      .query(async ({ ctx, input }) => {
        try {
          const organization = input?.organizationId
            ? { id: input.organizationId }
            : await ensureUserOrganization(ctx.user.id);
          return testSignozIntegration(organization.id);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    testGithub: protectedProcedure
      .input(z.object({ organizationId: z.string().uuid().optional() }).optional())
      .output(probeResultSchema)
      .query(async ({ ctx, input }) => {
        try {
          const organization = input?.organizationId
            ? { id: input.organizationId }
            : await ensureUserOrganization(ctx.user.id);
          return testGithubIntegration(organization.id);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    testJira: protectedProcedure
      .input(z.object({ organizationId: z.string().uuid().optional() }).optional())
      .output(probeResultSchema)
      .query(async ({ ctx, input }) => {
        try {
          const organization = input?.organizationId
            ? { id: input.organizationId }
            : await ensureUserOrganization(ctx.user.id);
          return testJiraIntegration(organization.id);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    testSlack: protectedProcedure
      .input(z.object({ organizationId: z.string().uuid().optional() }).optional())
      .output(probeResultSchema)
      .query(async ({ ctx, input }) => {
        try {
          const organization = input?.organizationId
            ? { id: input.organizationId }
            : await ensureUserOrganization(ctx.user.id);
          return testSlackIntegration(organization.id);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    testPagerDuty: protectedProcedure
      .input(z.object({ organizationId: z.string().uuid().optional() }).optional())
      .output(probeResultSchema)
      .query(async ({ ctx, input }) => {
        try {
          const organization = input?.organizationId
            ? { id: input.organizationId }
            : await ensureUserOrganization(ctx.user.id);
          return testPagerDutyIntegration(organization.id);
        } catch (error) {
          mapServiceError(error);
        }
      }),

    generateKubernetesOnboarding: protectedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid().optional(),
          clusterName: z.string().max(64).optional(),
          rotateSecret: z.boolean().optional(),
        }),
      )
      .output(
        z.object({
          clusterName: z.string(),
          webhookUrl: z.string(),
          webhookSecret: z.string(),
          maskedWebhookSecret: z.string().nullable(),
          organizationId: z.string(),
          helmInstallCommand: z.string(),
          helmUpgradeCommand: z.string(),
          helmUninstallCommand: z.string(),
          postInstallCheckUrl: z.string(),
          collectorConfigUrl: z.string(),
          requiredPermissions: z.array(z.string()),
          notes: z.array(z.string()),
          configured: z.boolean(),
          source: z.enum(["organization", "environment"]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const organization = input.organizationId
            ? { id: input.organizationId }
            : await ensureUserOrganization(ctx.user.id);
          return generateKubernetesOnboarding(ctx.user.id, organization.id, {
            clusterName: input.clusterName,
            rotateSecret: input.rotateSecret,
          });
        } catch (error) {
          mapServiceError(error);
        }
      }),

    /**
     * Self-service "Connect" for the signal webhooks (eBPF/feature-flag/CI-CD) — generates an
     * org-scoped secret (indexed hash-lookup, dual-secret rotation window) and returns the
     * ready-to-paste webhook URL + curl example, same UX bar as `generateKubernetesOnboarding`.
     */
    generateSignalWebhook: protectedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid().optional(),
          provider: webhookSignalProviderSchema,
          rotateSecret: z.boolean().optional(),
        }),
      )
      .output(
        z.object({
          provider: webhookSignalProviderSchema,
          label: z.string(),
          webhookUrl: z.string(),
          webhookSecret: z.string(),
          maskedWebhookSecret: z.string().nullable(),
          headerName: z.string(),
          docsHint: z.string(),
          curlExample: z.string(),
          configured: z.boolean(),
          source: z.enum(["organization", "environment"]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const organization = input.organizationId
            ? { id: input.organizationId }
            : await ensureUserOrganization(ctx.user.id);
          return generateWebhookSignalOnboarding(
            ctx.user.id,
            organization.id,
            input.provider as WebhookSignalProvider,
            { rotateSecret: input.rotateSecret },
          );
        } catch (error) {
          mapServiceError(error);
        }
      }),
  }),
});
