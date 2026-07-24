import { index, jsonb, pgTable, real, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { organizationsTable } from "./organization";

export const telemetrySamplingModes = [
  "normal",
  "elevated",
  "incident",
  "change_boost",
  "cooldown",
] as const;
export type TelemetrySamplingMode = (typeof telemetrySamplingModes)[number];

export const telemetrySamplingPoliciesTable = pgTable(
  "telemetry_sampling_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizationsTable.id, {
      onDelete: "cascade",
    }),
    serviceName: varchar("service_name", { length: 128 }).notNull(),
    mode: varchar("mode", { length: 32 }).$type<TelemetrySamplingMode>().notNull(),
    sampleRate: real("sample_rate").notNull(),
    reason: varchar("reason", { length: 512 }).notNull(),
    triggerSource: varchar("trigger_source", { length: 64 }).notNull(),
    investigationId: uuid("investigation_id"),
    expiresAt: timestamp("expires_at").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => ({
    orgServiceIdx: index("telemetry_sampling_org_service_idx").on(t.organizationId, t.serviceName),
    expiresIdx: index("telemetry_sampling_expires_idx").on(t.expiresAt),
  }),
);

export const telemetryIntelligenceEventsTable = pgTable(
  "telemetry_intelligence_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizationsTable.id, {
      onDelete: "set null",
    }),
    kind: varchar("kind", { length: 64 }).notNull(),
    serviceName: varchar("service_name", { length: 128 }),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    orgCreatedIdx: index("telemetry_intelligence_events_org_created_idx").on(
      t.organizationId,
      t.createdAt,
    ),
  }),
);

export type SelectTelemetrySamplingPolicy = typeof telemetrySamplingPoliciesTable.$inferSelect;
