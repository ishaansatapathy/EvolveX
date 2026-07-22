import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { usersTable } from "./user";
import { investigationsTable, investigationTimelineEntriesTable } from "./investigation";

export const changeEventTypeEnum = [
  "deployment",
  "commit",
  "config",
  "terraform",
  "kubernetes",
] as const;
export type ChangeEventType = (typeof changeEventTypeEnum)[number];

export const evidenceTypeEnum = [
  "alert",
  "github",
  "deployment",
  "trace",
  "metric",
  "log",
  "config",
  "ebpf",
  "change",
] as const;
export type EvidenceType = (typeof evidenceTypeEnum)[number];

export const changeEventsTable = pgTable(
  "change_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investigationId: uuid("investigation_id").references(() => investigationsTable.id, {
      onDelete: "cascade",
    }),
    type: varchar("type", { length: 32 }).$type<ChangeEventType>().notNull(),
    service: varchar("service", { length: 128 }),
    author: varchar("author", { length: 128 }),
    occurredAt: timestamp("occurred_at").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    investigationIdx: index("change_events_investigation_idx").on(t.investigationId, t.occurredAt),
    serviceIdx: index("change_events_service_idx").on(t.service, t.occurredAt),
  }),
);

export const runtimeSignalsTable = pgTable(
  "runtime_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigationsTable.id, { onDelete: "cascade" }),
    traceId: varchar("trace_id", { length: 64 }),
    service: varchar("service", { length: 128 }),
    metric: varchar("metric", { length: 128 }),
    latencyMs: integer("latency_ms"),
    p95Ms: integer("p95_ms"),
    p99Ms: integer("p99_ms"),
    errorRate: numeric("error_rate", { precision: 8, scale: 4 }),
    signalTimestamp: timestamp("signal_timestamp").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    investigationIdx: index("runtime_signals_investigation_idx").on(t.investigationId, t.signalTimestamp),
  }),
);

export const evidenceTable = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigationsTable.id, { onDelete: "cascade" }),
    timelineEntryId: uuid("timeline_entry_id").references(() => investigationTimelineEntriesTable.id, {
      onDelete: "set null",
    }),
    type: varchar("type", { length: 32 }).$type<EvidenceType>().notNull(),
    url: varchar("url", { length: 512 }),
    confidence: numeric("confidence", { precision: 5, scale: 2 }),
    description: text("description").notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    investigationIdx: index("evidence_investigation_idx").on(t.investigationId, t.occurredAt),
    typeIdx: index("evidence_type_idx").on(t.investigationId, t.type),
  }),
);

export const servicesTable = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 128 }).notNull().unique(),
  healthy: boolean("healthy").default(true).notNull(),
  latencyMs: integer("latency_ms"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
});

export const serviceDependenciesTable = pgTable(
  "service_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceServiceId: uuid("source_service_id")
      .notNull()
      .references(() => servicesTable.id, { onDelete: "cascade" }),
    destinationServiceId: uuid("destination_service_id")
      .notNull()
      .references(() => servicesTable.id, { onDelete: "cascade" }),
    healthy: boolean("healthy").default(true).notNull(),
    latencyMs: integer("latency_ms"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    edgeIdx: index("service_dependencies_edge_idx").on(t.sourceServiceId, t.destinationServiceId),
  }),
);

export const investigationNotesTable = pgTable(
  "investigation_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigationsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => ({
    investigationIdx: index("investigation_notes_investigation_idx").on(t.investigationId, t.createdAt),
  }),
);

export const investigationSummariesTable = pgTable(
  "investigation_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigationsTable.id, { onDelete: "cascade" }),
    markdown: text("markdown").notNull(),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  },
  (t) => ({
    investigationIdx: index("investigation_summaries_investigation_idx").on(t.investigationId, t.generatedAt),
  }),
);

export type SelectChangeEvent = typeof changeEventsTable.$inferSelect;
export type SelectRuntimeSignal = typeof runtimeSignalsTable.$inferSelect;
export type SelectEvidence = typeof evidenceTable.$inferSelect;
export type SelectService = typeof servicesTable.$inferSelect;
export type SelectServiceDependency = typeof serviceDependenciesTable.$inferSelect;
export type SelectInvestigationNote = typeof investigationNotesTable.$inferSelect;
export type SelectInvestigationSummary = typeof investigationSummariesTable.$inferSelect;
