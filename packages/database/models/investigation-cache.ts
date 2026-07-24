import { index, integer, jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { investigationsTable } from "./investigation";

/** Feature #18 — avoids re-running expensive SigNoz + LLM pipeline when evidence unchanged. */
export const investigationPipelineCacheTable = pgTable(
  "investigation_pipeline_cache",
  {
    investigationId: uuid("investigation_id")
      .primaryKey()
      .references(() => investigationsTable.id, { onDelete: "cascade" }),
    pipelineVersion: integer("pipeline_version").notNull(),
    contentFingerprint: varchar("content_fingerprint", { length: 128 }).notNull(),
    cachedAt: timestamp("cached_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  },
  (t) => ({
    expiresIdx: index("investigation_pipeline_cache_expires_idx").on(t.expiresAt),
  }),
);

export type SelectInvestigationPipelineCache = typeof investigationPipelineCacheTable.$inferSelect;
