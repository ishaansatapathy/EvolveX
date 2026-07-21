import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { usersTable } from "./user";

export const briefDismissalsTable = pgTable(
  "brief_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    dismissedAt: timestamp("dismissed_at").defaultNow().notNull(),
  },
  (t) => ({
    userThreadIdx: uniqueIndex("brief_dismissals_user_thread_idx").on(t.userId, t.threadId),
  }),
);

export type SelectBriefDismissal = typeof briefDismissalsTable.$inferSelect;
export type InsertBriefDismissal = typeof briefDismissalsTable.$inferInsert;
