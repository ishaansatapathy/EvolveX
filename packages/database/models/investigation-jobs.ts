import { index, integer, pgTable, text, timestamp, uuid, varchar, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { investigationsTable } from "./investigation";

export const investigationJobStatusEnum = ["pending", "running", "completed", "failed"] as const;
export type InvestigationJobStatus = (typeof investigationJobStatusEnum)[number];

export const investigationJobKindEnum = ["pipeline"] as const;
export type InvestigationJobKind = (typeof investigationJobKindEnum)[number];

export const investigationJobsTable = pgTable(
  "investigation_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigationsTable.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 32 }).$type<InvestigationJobKind>().default("pipeline").notNull(),
    status: varchar("status", { length: 20 }).$type<InvestigationJobStatus>().default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    errorMessage: text("error_message"),
    scheduledAt: timestamp("scheduled_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => ({
    statusCheck: check(
      "investigation_jobs_status_check",
      sql`${t.status} in ('pending', 'running', 'completed', 'failed')`,
    ),
    investigationStatusIdx: index("investigation_jobs_investigation_status_idx").on(
      t.investigationId,
      t.status,
    ),
    pendingIdx: index("investigation_jobs_pending_idx").on(t.status, t.scheduledAt),
  }),
);

export type SelectInvestigationJob = typeof investigationJobsTable.$inferSelect;
