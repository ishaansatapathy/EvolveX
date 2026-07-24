import { index, jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { usersTable } from "./user";

export const auditEventsTable = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    action: varchar("action", { length: 64 }).notNull(),
    resourceType: varchar("resource_type", { length: 64 }).notNull(),
    resourceId: varchar("resource_id", { length: 128 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    createdIdx: index("audit_events_created_idx").on(t.createdAt),
    resourceIdx: index("audit_events_resource_idx").on(t.resourceType, t.resourceId),
    actorIdx: index("audit_events_actor_idx").on(t.actorUserId, t.createdAt),
  }),
);

export type SelectAuditEvent = typeof auditEventsTable.$inferSelect;
export type InsertAuditEvent = typeof auditEventsTable.$inferInsert;
