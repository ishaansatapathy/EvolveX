import { jsonb, pgTable, text, timestamp, uuid, varchar, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { usersTable } from "./user";

export const queueItemKindEnum = [
  "email_send",
  "email_draft",
  "draft_send",
  "calendar_invite",
  "meeting_bundle",
  "calendar_archive",
  "calendar_delete",
  "calendar_update",
] as const;
export type QueueItemKind = (typeof queueItemKindEnum)[number];

export const queueItemStatusEnum = ["pending", "processing", "approved", "dismissed", "failed"] as const;
export type QueueItemStatus = (typeof queueItemStatusEnum)[number];

export const threadQueueItemsTable = pgTable(
  "thread_queue_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 32 }).$type<QueueItemKind>().notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    preview: text("preview"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    sourceThreadId: varchar("source_thread_id", { length: 128 }),
    status: varchar("status", { length: 20 }).$type<QueueItemStatus>().notNull().default("pending"),
    errorMessage: text("error_message"),
    processingAt: timestamp("processing_at"),
    createdAt: timestamp("created_at").defaultNow(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => ({
    kindCheck: check(
      "thread_queue_items_kind_check",
      sql`${table.kind} in ('email_send', 'email_draft', 'draft_send', 'calendar_invite', 'meeting_bundle', 'calendar_archive', 'calendar_delete', 'calendar_update')`,
    ),
    statusCheck: check(
      "thread_queue_items_status_check",
      sql`${table.status} in ('pending', 'processing', 'approved', 'dismissed', 'failed')`,
    ),
  }),
);

export type SelectQueueItem = typeof threadQueueItemsTable.$inferSelect;
export type InsertQueueItem = typeof threadQueueItemsTable.$inferInsert;
