import { and, desc, eq } from "@repo/database";
import db from "@repo/database";
import {
  agentChatHistoryTable,
  agentChatSessionsTable,
  type AgentSessionMessage,
  type AgentSessionToolMemoryEntry,
} from "@repo/database/schema";

import type { AgentFocus } from "./agent-focus";
import type { AgentToolMemoryEntry } from "./agent-tool-memory";

export type AgentSessionFocus = AgentFocus & {
  threadLabel?: string;
  eventLabel?: string;
};

export type AgentSessionRecord = {
  id: string;
  title: string | null;
  messages: AgentSessionMessage[];
  toolMemory: AgentToolMemoryEntry[];
  focus: AgentSessionFocus;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentSessionListItem = {
  id: string;
  title: string | null;
  messageCount: number;
  updatedAt: Date;
  focusThreadLabel: string | null;
  focusEventLabel: string | null;
};

const MAX_STORED_MESSAGES = 40;

/** Per-process: skip repeat migration checks on hot list path. */
const legacyMigrationChecked = new Set<string>();

function deriveSessionTitle(messages: AgentSessionMessage[]): string | null {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser?.content.trim()) return null;
  const compact = firstUser.content.trim().replace(/\s+/g, " ");
  return compact.length > 60 ? `${compact.slice(0, 57)}…` : compact;
}

function rowToRecord(row: typeof agentChatSessionsTable.$inferSelect): AgentSessionRecord {
  return {
    id: row.id,
    title: row.title,
    messages: row.messages ?? [],
    toolMemory: (row.toolMemory ?? []) as AgentToolMemoryEntry[],
    focus: {
      threadId: row.focusThreadId ?? undefined,
      eventId: row.focusEventId ?? undefined,
      threadLabel: row.focusThreadLabel ?? undefined,
      eventLabel: row.focusEventLabel ?? undefined,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listAgentSessions(userId: string, limit = 30): Promise<AgentSessionListItem[]> {
  await migrateLegacyAgentHistory(userId);

  const rows = await db
    .select({
      id: agentChatSessionsTable.id,
      title: agentChatSessionsTable.title,
      messages: agentChatSessionsTable.messages,
      updatedAt: agentChatSessionsTable.updatedAt,
      focusThreadLabel: agentChatSessionsTable.focusThreadLabel,
      focusEventLabel: agentChatSessionsTable.focusEventLabel,
    })
    .from(agentChatSessionsTable)
    .where(eq(agentChatSessionsTable.userId, userId))
    .orderBy(desc(agentChatSessionsTable.updatedAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    messageCount: row.messages?.length ?? 0,
    updatedAt: row.updatedAt,
    focusThreadLabel: row.focusThreadLabel,
    focusEventLabel: row.focusEventLabel,
  }));
}

export async function getAgentSession(userId: string, sessionId: string): Promise<AgentSessionRecord | null> {
  const [row] = await db
    .select()
    .from(agentChatSessionsTable)
    .where(and(eq(agentChatSessionsTable.userId, userId), eq(agentChatSessionsTable.id, sessionId)))
    .limit(1);

  return row ? rowToRecord(row) : null;
}

export async function createAgentSession(
  userId: string,
  opts?: {
    title?: string | null;
    messages?: AgentSessionMessage[];
    toolMemory?: AgentToolMemoryEntry[];
    focus?: AgentSessionFocus;
  },
): Promise<AgentSessionRecord> {
  const messages = opts?.messages ?? [];
  const title = opts?.title ?? deriveSessionTitle(messages);
  const focus = opts?.focus ?? {};

  const [row] = await db
    .insert(agentChatSessionsTable)
    .values({
      userId,
      title,
      messages,
      toolMemory: (opts?.toolMemory ?? []) as AgentSessionToolMemoryEntry[],
      focusThreadId: focus.threadId ?? null,
      focusEventId: focus.eventId ?? null,
      focusThreadLabel: focus.threadLabel ?? null,
      focusEventLabel: focus.eventLabel ?? null,
      updatedAt: new Date(),
    })
    .returning();

  if (!row) throw new Error("Failed to create agent session");
  return rowToRecord(row);
}

export async function updateAgentSession(
  userId: string,
  sessionId: string,
  patch: {
    title?: string | null;
    messages?: AgentSessionMessage[];
    toolMemory?: AgentToolMemoryEntry[];
    focus?: AgentSessionFocus | null;
  },
): Promise<AgentSessionRecord | null> {
  const existing = await getAgentSession(userId, sessionId);
  if (!existing) return null;

  const messages = patch.messages ?? existing.messages;
  const title = patch.title !== undefined ? patch.title : existing.title ?? deriveSessionTitle(messages);

  let focus: AgentSessionFocus;
  if (patch.focus === null) {
    focus = {};
  } else if (patch.focus !== undefined) {
    focus = {
      threadId: patch.focus.threadId,
      eventId: patch.focus.eventId,
      threadLabel: patch.focus.threadLabel,
      eventLabel: patch.focus.eventLabel,
    };
  } else {
    focus = existing.focus;
  }

  const [row] = await db
    .update(agentChatSessionsTable)
    .set({
      title,
      messages: messages.slice(-MAX_STORED_MESSAGES),
      toolMemory: (patch.toolMemory ?? existing.toolMemory) as AgentSessionToolMemoryEntry[],
      focusThreadId: focus.threadId ?? null,
      focusEventId: focus.eventId ?? null,
      focusThreadLabel: focus.threadLabel ?? null,
      focusEventLabel: focus.eventLabel ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(agentChatSessionsTable.userId, userId), eq(agentChatSessionsTable.id, sessionId)))
    .returning();

  return row ? rowToRecord(row) : null;
}

export async function deleteAgentSession(userId: string, sessionId: string): Promise<boolean> {
  const deleted = await db
    .delete(agentChatSessionsTable)
    .where(and(eq(agentChatSessionsTable.userId, userId), eq(agentChatSessionsTable.id, sessionId)))
    .returning({ id: agentChatSessionsTable.id });
  return deleted.length > 0;
}

export async function appendAgentSessionTurn(
  userId: string,
  sessionId: string,
  input: {
    userMessage: string;
    assistantReply: string;
    toolMemory: AgentToolMemoryEntry[];
    focus?: AgentSessionFocus | null;
    focusCleared?: boolean;
  },
): Promise<AgentSessionRecord | null> {
  const existing = await getAgentSession(userId, sessionId);
  if (!existing) return null;

  const messages: AgentSessionMessage[] = [
    ...existing.messages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: input.userMessage },
    { role: "assistant" as const, content: input.assistantReply },
  ].slice(-MAX_STORED_MESSAGES);

  return updateAgentSession(userId, sessionId, {
    messages,
    toolMemory: input.toolMemory,
    focus: input.focusCleared ? null : input.focus !== undefined ? input.focus : undefined,
    title: existing.title ?? deriveSessionTitle(messages),
  });
}

/** One-time migration: legacy single-row history → first session. */
export async function migrateLegacyAgentHistory(userId: string): Promise<string | null> {
  if (legacyMigrationChecked.has(userId)) return null;

  const [[existingSession], [legacy]] = await Promise.all([
    db
      .select({ id: agentChatSessionsTable.id })
      .from(agentChatSessionsTable)
      .where(eq(agentChatSessionsTable.userId, userId))
      .limit(1),
    db
      .select({ messages: agentChatHistoryTable.messages })
      .from(agentChatHistoryTable)
      .where(eq(agentChatHistoryTable.userId, userId))
      .limit(1),
  ]);

  if (existingSession) {
    legacyMigrationChecked.add(userId);
    return null;
  }

  if (!legacy?.messages?.length) {
    legacyMigrationChecked.add(userId);
    return null;
  }

  const session = await createAgentSession(userId, { messages: legacy.messages });
  legacyMigrationChecked.add(userId);
  return session.id;
}
