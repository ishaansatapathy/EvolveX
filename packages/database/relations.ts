import { relations } from "drizzle-orm";

import { agentChatHistoryTable } from "./models/agent-chat-history";
import { agentChatSessionsTable } from "./models/agent-chat-session";
import { briefDismissalsTable } from "./models/brief-dismissals";
import { threadMailCacheTable } from "./models/mail-cache";
import { threadQueueItemsTable } from "./models/queue-item";
import { threadContactsTable } from "./models/thread-contact";
import { usersTable } from "./models/user";

export const usersRelations = relations(usersTable, ({ many, one }) => ({
  queueItems: many(threadQueueItemsTable),
  contacts: many(threadContactsTable),
  mailCache: many(threadMailCacheTable),
  briefDismissals: many(briefDismissalsTable),
  agentChatHistory: one(agentChatHistoryTable, {
    fields: [usersTable.id],
    references: [agentChatHistoryTable.userId],
  }),
  agentChatSessions: many(agentChatSessionsTable),
}));

export const threadQueueItemsRelations = relations(threadQueueItemsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [threadQueueItemsTable.userId],
    references: [usersTable.id],
  }),
}));

export const threadContactsRelations = relations(threadContactsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [threadContactsTable.userId],
    references: [usersTable.id],
  }),
}));

export const threadMailCacheRelations = relations(threadMailCacheTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [threadMailCacheTable.userId],
    references: [usersTable.id],
  }),
}));

export const agentChatHistoryRelations = relations(agentChatHistoryTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [agentChatHistoryTable.userId],
    references: [usersTable.id],
  }),
}));

export const agentChatSessionsRelations = relations(agentChatSessionsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [agentChatSessionsTable.userId],
    references: [usersTable.id],
  }),
}));

export const briefDismissalsRelations = relations(briefDismissalsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [briefDismissalsTable.userId],
    references: [usersTable.id],
  }),
}));
