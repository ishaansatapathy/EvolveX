import { jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { usersTable } from "./user";

export type AgentSessionMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentSessionToolMemoryEntry = {
  at: string;
  tool: string;
  summary: string;
  threadId?: string;
  eventId?: string;
  query?: string;
};

export const agentChatSessionsTable = pgTable("agent_chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 120 }),
  messages: jsonb("messages").$type<AgentSessionMessage[]>().notNull().default([]),
  toolMemory: jsonb("tool_memory").$type<AgentSessionToolMemoryEntry[]>().notNull().default([]),
  focusThreadId: varchar("focus_thread_id", { length: 128 }),
  focusEventId: varchar("focus_event_id", { length: 256 }),
  focusThreadLabel: varchar("focus_thread_label", { length: 200 }),
  focusEventLabel: varchar("focus_event_label", { length: 200 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SelectAgentChatSession = typeof agentChatSessionsTable.$inferSelect;
export type InsertAgentChatSession = typeof agentChatSessionsTable.$inferInsert;
