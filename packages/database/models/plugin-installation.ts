import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

import { organizationsTable } from "./organization";
import { usersTable } from "./user";

export const pluginInstallationsTable = pgTable(
  "plugin_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    pluginId: varchar("plugin_id", { length: 64 }).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().default({}).notNull(),
    webhookSecretEncrypted: text("webhook_secret_encrypted").notNull(),
    installedByUserId: uuid("installed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => ({
    orgPluginUnique: uniqueIndex("plugin_installations_org_plugin_idx").on(t.organizationId, t.pluginId),
    orgIdx: index("plugin_installations_org_idx").on(t.organizationId),
  }),
);

export type SelectPluginInstallation = typeof pluginInstallationsTable.$inferSelect;
export type InsertPluginInstallation = typeof pluginInstallationsTable.$inferInsert;
