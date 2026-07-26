import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organizationsTable } from "./organization";
import { usersTable } from "./user";

export const organizationIntegrationProviders = [
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
export type OrganizationIntegrationProvider = (typeof organizationIntegrationProviders)[number];

/**
 * Providers authenticated by a single shared-secret webhook (vs. OAuth/API-key providers above).
 * `signoz` joined this list so alert-webhook routing can resolve the owning workspace from an
 * indexed secret hash instead of always falling back to the single global
 * `INVESTIGATION_OWNER_EMAIL` — see ADR-005 amendment and `resolveOrganizationIdForWebhookSecret`.
 */
export const webhookSecretProviders = ["kubernetes", "ebpf", "feature_flag", "cicd", "signoz"] as const;
export type WebhookSecretProvider = (typeof webhookSecretProviders)[number];

export const organizationIntegrationsTable = pgTable(
  "organization_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).$type<OrganizationIntegrationProvider>().notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().default({}).notNull(),
    secretsEncrypted: text("secrets_encrypted").notNull(),
    /**
     * SHA-256 hex of the current webhook secret (kubernetes/ebpf/feature_flag/cicd/signoz) — lets an
     * inbound webhook resolve its owning organization with an indexed lookup instead of decrypting
     * every row in the table (O(1) vs O(n), required once you have >dozens of tenants).
     */
    secretHash: varchar("secret_hash", { length: 64 }),
    /** Previous secret's hash, kept valid for `previousSecretExpiresAt` so rotating a secret never causes a hard outage. */
    previousSecretHash: varchar("previous_secret_hash", { length: 64 }),
    previousSecretExpiresAt: timestamp("previous_secret_expires_at"),
    updatedByUserId: uuid("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => ({
    providerCheck: check(
      "organization_integrations_provider_check",
      sql`${t.provider} in ('signoz', 'github', 'slack', 'pagerduty', 'jira', 'kubernetes', 'ebpf', 'feature_flag', 'cicd')`,
    ),
    orgProviderUnique: uniqueIndex("organization_integrations_org_provider_idx").on(
      t.organizationId,
      t.provider,
    ),
    orgIdx: index("organization_integrations_org_idx").on(t.organizationId),
    secretHashIdx: index("organization_integrations_secret_hash_idx").on(t.provider, t.secretHash),
    previousSecretHashIdx: index("organization_integrations_previous_secret_hash_idx").on(
      t.provider,
      t.previousSecretHash,
    ),
  }),
);

export type SelectOrganizationIntegration = typeof organizationIntegrationsTable.$inferSelect;
