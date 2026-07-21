import { pgTable, uuid, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { usersTable } from "./user";

export const agentChatHistoryTable = pgTable(
  "agent_chat_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    messages: jsonb("messages").$type<Array<{ role: "user" | "assistant"; content: string }>>().notNull().default([]),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    userIdx: uniqueIndex("agent_chat_history_user_id_idx").on(t.userId),
  }),
);

export type SelectAgentChatHistory = typeof agentChatHistoryTable.$inferSelect;
export type InsertAgentChatHistory = typeof agentChatHistoryTable.$inferInsert;
