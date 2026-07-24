import { z } from "zod";

import {
  listOrganizationIntegrations,
  removeOrganizationIntegration,
  testGithubIntegration,
  testSignozIntegration,
  upsertGithubIntegration,
  upsertPagerDutyIntegration,
  upsertSignozIntegration,
  upsertSlackIntegration,
} from "@repo/services/organization/integrations";
import { ensureUserOrganization } from "@repo/services/organization";

import { mapServiceError, protectedProcedure, router } from "../../trpc";

const TAGS = ["Organizations"];

const integrationSummarySchema = z.object({
  provider: z.enum(["signoz", "github", "slack", "pagerduty"]),
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
        }),
      )
      .output(z.object({ ok: z.literal(true) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const organization = input.organizationId
            ? { id: input.organizationId }
            : await ensureUserOrganization(ctx.user.id);
          await upsertGithubIntegration(ctx.user.id, organization.id, input);
          return { ok: true as const };
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

    remove: protectedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid().optional(),
          provider: z.enum(["signoz", "github", "slack", "pagerduty"]),
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
  }),
});
