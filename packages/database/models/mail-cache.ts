import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

/**
 * Local, denormalized cache of Gmail thread metadata per tenant (user).
 *
 * Gmail's `threads.list` only returns ids + snippets, so rendering a rich inbox
 * requires an extra `threads.get` per row. We persist that enriched metadata
 * here so subsequent loads are instant, search works offline, and webhook
 * pushes can update a single row instead of re-fetching the whole mailbox.
 */
export const threadMailCacheTable = pgTable(
  "thread_mail_cache",
  {
    id: text("id").primaryKey(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    threadId: varchar("thread_id", { length: 128 }).notNull(),
    historyId: varchar("history_id", { length: 64 }),
    subject: text("subject"),
    fromName: text("from_name"),
    fromAddress: varchar("from_address", { length: 320 }),
    snippet: text("snippet"),
    lastMessageAt: timestamp("last_message_at"),
    messageCount: integer("message_count").notNull().default(1),
    unread: boolean("unread").notNull().default(false),
    labelIds: jsonb("label_ids").$type<string[]>().notNull().default([]),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userThreadUnique: uniqueIndex("thread_mail_cache_user_thread_unique").on(
      table.userId,
      table.threadId,
    ),
    userRecentIdx: index("thread_mail_cache_user_recent_idx").on(
      table.userId,
      table.lastMessageAt,
    ),
  }),
);

export type SelectMailCacheRow = typeof threadMailCacheTable.$inferSelect;
export type InsertMailCacheRow = typeof threadMailCacheTable.$inferInsert;
