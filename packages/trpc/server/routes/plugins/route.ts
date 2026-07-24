import { z } from "zod";

import { ensureUserOrganization } from "@repo/services/organization";
import {
  PLUGIN_CATALOG,
  installPlugin,
  listPluginInstallations,
  removePluginInstallation,
  setPluginEnabled,
  assertPluginOrganizationOwner,
} from "@repo/services/plugins";
import { isSdkConfigured } from "@repo/services/sdk";

import { mapServiceError, protectedProcedure, router } from "../../trpc";

const TAGS = ["Plugins"];

const pluginDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(["custom", "import", "security", "ai"]),
  version: z.string(),
  hooks: z.array(z.enum(["timeline", "pre_investigation", "evidence"])),
  webhookPath: z.string(),
  docs: z.string(),
});

export const pluginsRouter = router({
  catalog: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/plugins/catalog", tags: TAGS } })
    .input(z.object({}).optional())
    .output(z.array(pluginDefinitionSchema))
    .query(() => PLUGIN_CATALOG),

  sdkStatus: protectedProcedure
    .input(z.object({}).optional())
    .output(
      z.object({
        configured: z.boolean(),
        baseUrl: z.string(),
        docsPath: z.string(),
      }),
    )
    .query(() => {
      const baseUrl = (process.env.BASE_URL?.trim() || "http://localhost:8000").replace(/\/+$/, "");
      return {
        configured: isSdkConfigured(),
        baseUrl: `${baseUrl}/api/v1/sdk`,
        docsPath: "/api/v1/sdk",
      };
    }),

  installations: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/plugins/installations", tags: TAGS } })
    .input(z.object({ organizationId: z.string().uuid().optional() }).optional())
    .output(
      z.array(
        z.object({
          id: z.string().uuid(),
          pluginId: z.string(),
          enabled: z.boolean(),
          config: z.record(z.string(), z.unknown()),
          webhookUrl: z.string(),
          maskedWebhookSecret: z.string().nullable(),
          installedAt: z.string(),
          updatedAt: z.string().nullable(),
          definition: pluginDefinitionSchema,
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      try {
        const organization = input?.organizationId
          ? { id: input.organizationId }
          : await ensureUserOrganization(ctx.user.id);
        return listPluginInstallations(organization.id);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  install: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid().optional(),
        pluginId: z.string().min(1).max(64),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .output(
      z.object({
        installationId: z.string().uuid(),
        pluginId: z.string(),
        webhookSecret: z.string(),
        webhookUrl: z.string(),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const organization = input.organizationId
          ? { id: input.organizationId }
          : await ensureUserOrganization(ctx.user.id);
        await assertPluginOrganizationOwner(ctx.user.id, organization.id);
        return installPlugin({
          organizationId: organization.id,
          pluginId: input.pluginId,
          userId: ctx.user.id,
          config: input.config,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  setEnabled: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid().optional(),
        pluginId: z.string().min(1).max(64),
        enabled: z.boolean(),
      }),
    )
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const organization = input.organizationId
          ? { id: input.organizationId }
          : await ensureUserOrganization(ctx.user.id);
        await assertPluginOrganizationOwner(ctx.user.id, organization.id);
        const row = await setPluginEnabled({
          organizationId: organization.id,
          pluginId: input.pluginId,
          enabled: input.enabled,
        });
        if (!row) {
          throw new Error("Plugin installation not found");
        }
        return { ok: true as const };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  remove: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid().optional(),
        pluginId: z.string().min(1).max(64),
      }),
    )
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const organization = input.organizationId
          ? { id: input.organizationId }
          : await ensureUserOrganization(ctx.user.id);
        await assertPluginOrganizationOwner(ctx.user.id, organization.id);
        await removePluginInstallation({
          organizationId: organization.id,
          pluginId: input.pluginId,
        });
        return { ok: true as const };
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
