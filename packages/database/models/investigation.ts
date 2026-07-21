import { jsonb, pgTable, text, timestamp, uuid, varchar, integer, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const investigationStatusEnum = ["building", "ready", "failed"] as const;
export type InvestigationStatus = (typeof investigationStatusEnum)[number];

export const timelineKindEnum = [
  "ALERT",
  "DEPLOY",
  "METRIC",
  "LOG",
  "TRACE",
  "CHANGE",
  "EBPF",
  "AI",
] as const;
export type TimelineKind = (typeof timelineKindEnum)[number];

export const investigationsTable = pgTable(
  "investigations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalId: varchar("external_id", { length: 128 }),
    title: varchar("title", { length: 255 }).notNull(),
    status: varchar("status", { length: 20 }).$type<InvestigationStatus>().default("building").notNull(),
    severity: varchar("severity", { length: 32 }),
    alertName: varchar("alert_name", { length: 255 }),
    affectedServices: jsonb("affected_services").$type<string[]>().default([]).notNull(),
    incidentWindowStart: timestamp("incident_window_start"),
    incidentWindowEnd: timestamp("incident_window_end"),
    signozAlertPayload: jsonb("signoz_alert_payload"),
    investigationContext: jsonb("investigation_context"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => ({
    statusCheck: check(
      "investigations_status_check",
      sql`${t.status} in ('building', 'ready', 'failed')`,
    ),
  }),
);

export const investigationTimelineEntriesTable = pgTable("investigation_timeline_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  investigationId: uuid("investigation_id")
    .notNull()
    .references(() => investigationsTable.id, { onDelete: "cascade" }),
  occurredAt: timestamp("occurred_at").notNull(),
  kind: varchar("kind", { length: 20 }).$type<TimelineKind>().notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  detail: text("detail").notNull(),
  sourceRef: jsonb("source_ref"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SelectInvestigation = typeof investigationsTable.$inferSelect;
export type InsertInvestigation = typeof investigationsTable.$inferInsert;
export type SelectTimelineEntry = typeof investigationTimelineEntriesTable.$inferSelect;
export type InsertTimelineEntry = typeof investigationTimelineEntriesTable.$inferInsert;
