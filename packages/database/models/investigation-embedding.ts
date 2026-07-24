import { index, jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { investigationsTable } from "./investigation";

export const investigationEmbeddingsTable = pgTable(
  "investigation_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigationsTable.id, { onDelete: "cascade" })
      .unique(),
    model: varchar("model", { length: 64 }).notNull(),
    embedding: jsonb("embedding").$type<number[]>().notNull(),
    sourceText: varchar("source_text", { length: 512 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    investigationIdx: index("investigation_embeddings_investigation_idx").on(t.investigationId),
  }),
);

export type SelectInvestigationEmbedding = typeof investigationEmbeddingsTable.$inferSelect;
