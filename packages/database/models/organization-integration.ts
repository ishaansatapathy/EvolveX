import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organizationsTable } from "./organization";
import { usersTable } from "./user";

export const organizationIntegrationProviders = ["signoz", "github", "slack", "pagerduty"] as const;
export type OrganizationIntegrationProvider = (typeof organizationIntegrationProviders)[number];

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
    updatedByUserId: uuid("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => ({
    providerCheck: check(
      "organization_integrations_provider_check",
      sql`${t.provider} in ('signoz', 'github', 'slack', 'pagerduty')`,
    ),
    orgProviderUnique: uniqueIndex("organization_integrations_org_provider_idx").on(
      t.organizationId,
      t.provider,
    ),
    orgIdx: index("organization_integrations_org_idx").on(t.organizationId),
  }),
);

export type SelectOrganizationIntegration = typeof organizationIntegrationsTable.$inferSelect;
