import { randomBytes } from "node:crypto";
import { and, eq } from "@repo/database";
import { db } from "@repo/database";
import { organizationMembersTable, pluginInstallationsTable } from "@repo/database/schema";

import { serviceError } from "../errors";
import { encryptSecretPayload, decryptSecretPayload, maskSecret } from "../crypto/secrets";
import { getPluginDefinition, PLUGIN_CATALOG, type PluginDefinition } from "./catalog";

export async function assertPluginOrganizationOwner(userId: string, organizationId: string) {
  const [member] = await db
    .select({ role: organizationMembersTable.role })
    .from(organizationMembersTable)
    .where(
      and(
        eq(organizationMembersTable.organizationId, organizationId),
        eq(organizationMembersTable.userId, userId),
      ),
    )
    .limit(1);

  if (!member || member.role !== "owner") {
    throw serviceError("FORBIDDEN", "Organization owner access required to manage plugins");
  }
}

export type PluginInstallationSummary = {
  id: string;
  pluginId: string;
  enabled: boolean;
  config: Record<string, unknown>;
  webhookUrl: string;
  maskedWebhookSecret: string | null;
  installedAt: string;
  updatedAt: string | null;
  definition: PluginDefinition;
};

function baseUrl() {
  return (process.env.BASE_URL?.trim() || "http://localhost:8000").replace(/\/+$/, "");
}

function generatePluginWebhookSecret() {
  return `evxplg_${randomBytes(18).toString("hex")}`;
}

export function listPluginCatalog() {
  return PLUGIN_CATALOG;
}

export async function listPluginInstallations(organizationId: string): Promise<PluginInstallationSummary[]> {
  const rows = await db
    .select()
    .from(pluginInstallationsTable)
    .where(eq(pluginInstallationsTable.organizationId, organizationId));

  return rows
    .map((row) => {
      const definition = getPluginDefinition(row.pluginId);
      if (!definition) return null;

      let maskedWebhookSecret: string | null = null;
      try {
        const secrets = decryptSecretPayload(row.webhookSecretEncrypted);
        maskedWebhookSecret = maskSecret(typeof secrets.webhookSecret === "string" ? secrets.webhookSecret : null);
      } catch {
        maskedWebhookSecret = "••••";
      }

      return {
        id: row.id,
        pluginId: row.pluginId,
        enabled: row.enabled,
        config: row.config ?? {},
        webhookUrl: `${baseUrl()}${definition.webhookPath}`,
        maskedWebhookSecret,
        installedAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt?.toISOString() ?? null,
        definition,
      };
    })
    .filter((row): row is PluginInstallationSummary => row !== null);
}

export async function installPlugin(input: {
  organizationId: string;
  pluginId: string;
  userId: string;
  config?: Record<string, unknown>;
}) {
  const definition = getPluginDefinition(input.pluginId);
  if (!definition) {
    throw new Error(`Unknown plugin: ${input.pluginId}`);
  }

  const webhookSecret = generatePluginWebhookSecret();
  const encrypted = encryptSecretPayload({ webhookSecret });

  const [row] = await db
    .insert(pluginInstallationsTable)
    .values({
      organizationId: input.organizationId,
      pluginId: input.pluginId,
      enabled: true,
      config: input.config ?? {},
      webhookSecretEncrypted: encrypted,
      installedByUserId: input.userId,
    })
    .onConflictDoUpdate({
      target: [pluginInstallationsTable.organizationId, pluginInstallationsTable.pluginId],
      set: {
        enabled: true,
        config: input.config ?? {},
        updatedAt: new Date(),
      },
    })
    .returning();

  return {
    installationId: row!.id,
    pluginId: input.pluginId,
    webhookSecret,
    webhookUrl: `${baseUrl()}${definition.webhookPath}`,
    enabled: row!.enabled,
  };
}

export async function setPluginEnabled(input: {
  organizationId: string;
  pluginId: string;
  enabled: boolean;
}) {
  const [row] = await db
    .update(pluginInstallationsTable)
    .set({ enabled: input.enabled, updatedAt: new Date() })
    .where(
      and(
        eq(pluginInstallationsTable.organizationId, input.organizationId),
        eq(pluginInstallationsTable.pluginId, input.pluginId),
      ),
    )
    .returning();

  return row ?? null;
}

export async function verifyPluginWebhookSecret(input: {
  organizationId: string;
  pluginId: string;
  providedSecret: string | undefined;
}) {
  const [row] = await db
    .select()
    .from(pluginInstallationsTable)
    .where(
      and(
        eq(pluginInstallationsTable.organizationId, input.organizationId),
        eq(pluginInstallationsTable.pluginId, input.pluginId),
        eq(pluginInstallationsTable.enabled, true),
      ),
    )
    .limit(1);

  if (!row) return { ok: false as const, reason: "not_installed" as const };

  let webhookSecret: string;
  try {
    const secrets = decryptSecretPayload(row.webhookSecretEncrypted);
    webhookSecret = typeof secrets.webhookSecret === "string" ? secrets.webhookSecret : "";
  } catch {
    return { ok: false as const, reason: "secret_error" as const };
  }

  if (!input.providedSecret || input.providedSecret !== webhookSecret) {
    return { ok: false as const, reason: "invalid_secret" as const };
  }

  return { ok: true as const, installation: row };
}

export async function removePluginInstallation(input: { organizationId: string; pluginId: string }) {
  await db
    .delete(pluginInstallationsTable)
    .where(
      and(
        eq(pluginInstallationsTable.organizationId, input.organizationId),
        eq(pluginInstallationsTable.pluginId, input.pluginId),
      ),
    );
}
