import { index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { investigationsTable } from "./investigation";
import { organizationsTable } from "./organization";
import { usersTable } from "./user";

/** Feature #25 — durable learnings from resolved investigations. */
export const investigationMemoryTable = pgTable(
  "investigation_memory",
  {
    investigationId: uuid("investigation_id")
      .primaryKey()
      .references(() => investigationsTable.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizationsTable.id, {
      onDelete: "set null",
    }),
    ownerUserId: uuid("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    symptoms: text("symptoms").notNull(),
    rootCause: text("root_cause"),
    fixApplied: text("fix_applied"),
    fixOutcome: varchar("fix_outcome", { length: 32 }).default("resolved").notNull(),
    durationMs: integer("duration_ms"),
    impactSummary: text("impact_summary"),
    resolvedAt: timestamp("resolved_at").defaultNow().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => ({
    orgResolvedIdx: index("investigation_memory_org_resolved_idx").on(t.organizationId, t.resolvedAt),
  }),
);

export type SelectInvestigationMemory = typeof investigationMemoryTable.$inferSelect;
