import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./user";

export const threadGmailStateTable = pgTable("thread_gmail_state", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  historyId: varchar("history_id", { length: 64 }),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type SelectGmailState = typeof threadGmailStateTable.$inferSelect;
export type InsertGmailState = typeof threadGmailStateTable.$inferInsert;
