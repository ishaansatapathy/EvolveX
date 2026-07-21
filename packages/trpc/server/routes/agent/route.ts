import { z } from "zod";

import { logger } from "@repo/logger";
import { isAgentConfigured, runAgentChat } from "@repo/services/ai/agent";
import { eq } from "@repo/database";
import db from "@repo/database";
import { agentChatHistoryTable } from "@repo/database/schema";
import {
  appendAgentSessionTurn,
  createAgentSession,
  deleteAgentSession,
  getAgentSession,
  listAgentSessions,
  updateAgentSession,
} from "@repo/services/ai/agent-sessions";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";
import { invalidateBriefCache } from "../ai/route";

const TAGS = ["Agent"];
const getPath = generatePath("/agent");

const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(8000),
});

const toolMemoryEntrySchema = z.object({
  at: z.string(),
  tool: z.string(),
  summary: z.string(),
  threadId: z.string().optional(),
  eventId: z.string().optional(),
  query: z.string().optional(),
});

const sessionFocusSchema = z.object({
  threadId: z.string().optional(),
  eventId: z.string().optional(),
  threadLabel: z.string().optional(),
  eventLabel: z.string().optional(),
});

const sessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  messages: z.array(historyMessageSchema),
  toolMemory: z.array(toolMemoryEntrySchema),
  focus: sessionFocusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

const sessionListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  messageCount: z.number(),
  updatedAt: z.coerce.date(),
  focusThreadLabel: z.string().nullable(),
  focusEventLabel: z.string().nullable(),
});

const MAX_STORED_MESSAGES = 40;

const actionCardSchema = z.object({
  kind: z.enum(["email_queued", "calendar_queued", "inbox_search", "inbox_ranked", "queue_list", "thread", "calendar", "email"]),
  title: z.string(),
  detail: z.string().optional(),
  href: z.string().optional(),
  lines: z.array(z.string()).optional(),
  disposition: z.enum(["sent", "queued"]).optional(),
  queueItemId: z.string().uuid().optional(),
  threadId: z.string().optional(),
});

export const agentRouter = router({
  status: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/status"), tags: TAGS } })
    .input(z.object({}))
    .output(
      z.object({
        ready: z.boolean(),
        model: z.string().optional(),
      }),
    )
    .query(async () => ({
      ready: isAgentConfigured(),
      model: isAgentConfigured() ? process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini" : undefined,
    })),

  chat: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/chat"), tags: TAGS } })
    .input(
      z.object({
        message: z.string().trim().min(1).max(4000),
        history: z.array(historyMessageSchema).max(24).optional(),
        focusThreadId: z.string().trim().min(1).max(128).optional(),
        focusEventId: z.string().trim().min(1).max(256).optional(),
        toolMemory: z.array(toolMemoryEntrySchema).max(12).optional(),
      }),
    )
    .output(
      z.object({
        reply: z.string(),
        actions: z.array(actionCardSchema),
        focusCleared: z.boolean().optional(),
        toolMemory: z.array(toolMemoryEntrySchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      logger.info("agent.chat_invoked", {
        userId: ctx.user.id,
        messageLength: input.message.length,
        historyLength: input.history?.length ?? 0,
      });
      try {
        const result = await runAgentChat(ctx.user.id, {
          message: input.message,
          history: input.history,
          userEmail: ctx.user.email,
          focus: {
            threadId: input.focusThreadId,
            eventId: input.focusEventId,
          },
          toolMemory: input.toolMemory,
        });
        if (result.actions.some((a) => a.kind === "email_queued" || a.kind === "calendar_queued")) {
          invalidateBriefCache(ctx.user.id);
        }
        return {
          reply: result.reply,
          actions: result.actions,
          focusCleared: result.focusCleared,
          toolMemory: result.toolMemory,
        };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  listSessions: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/sessions"), tags: TAGS } })
    .input(z.object({ limit: z.number().int().min(1).max(50).optional() }))
    .output(z.array(sessionListItemSchema))
    .query(async ({ ctx, input }) => {
      try {
        return await listAgentSessions(ctx.user.id, input.limit ?? 30);
      } catch {
        return [];
      }
    }),

  getSession: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/sessions/{id}"), tags: TAGS } })
    .input(z.object({ id: z.string().uuid() }))
    .output(sessionSchema.nullable())
    .query(async ({ ctx, input }) => {
      try {
        return await getAgentSession(ctx.user.id, input.id);
      } catch {
        return null;
      }
    }),

  createSession: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/sessions"), tags: TAGS } })
    .input(
      z.object({
        title: z.string().max(120).nullable().optional(),
        focus: sessionFocusSchema.optional(),
      }),
    )
    .output(sessionSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await createAgentSession(ctx.user.id, {
          title: input.title,
          focus: input.focus,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  updateSession: protectedProcedure
    .meta({ openapi: { method: "PATCH", path: getPath("/sessions/{id}"), tags: TAGS } })
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().max(120).nullable().optional(),
        messages: z.array(historyMessageSchema).max(MAX_STORED_MESSAGES).optional(),
        toolMemory: z.array(toolMemoryEntrySchema).max(12).optional(),
        focus: sessionFocusSchema.nullable().optional(),
      }),
    )
    .output(sessionSchema.nullable())
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateAgentSession(ctx.user.id, input.id, {
          title: input.title,
          messages: input.messages,
          toolMemory: input.toolMemory,
          focus: input.focus,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  deleteSession: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: getPath("/sessions/{id}"), tags: TAGS } })
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const ok = await deleteAgentSession(ctx.user.id, input.id);
        return { ok };
      } catch {
        return { ok: false };
      }
    }),

  appendSessionTurn: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/sessions/{id}/turn"), tags: TAGS } })
    .input(
      z.object({
        id: z.string().uuid(),
        userMessage: z.string().trim().min(1).max(4000),
        assistantReply: z.string().max(8000),
        toolMemory: z.array(toolMemoryEntrySchema).max(12),
        focus: sessionFocusSchema.nullable().optional(),
        focusCleared: z.boolean().optional(),
      }),
    )
    .output(sessionSchema.nullable())
    .mutation(async ({ ctx, input }) => {
      try {
        return await appendAgentSessionTurn(ctx.user.id, input.id, {
          userMessage: input.userMessage,
          assistantReply: input.assistantReply,
          toolMemory: input.toolMemory,
          focus: input.focus,
          focusCleared: input.focusCleared,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** @deprecated Use sessions — kept for backward compatibility during migration */
  getHistory: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/history"), tags: TAGS } })
    .input(z.object({}))
    .output(z.array(historyMessageSchema))
    .query(async ({ ctx }) => {
      try {
        const [row] = await db
          .select({ messages: agentChatHistoryTable.messages })
          .from(agentChatHistoryTable)
          .where(eq(agentChatHistoryTable.userId, ctx.user.id))
          .limit(1);
        return (row?.messages ?? []).slice(-MAX_STORED_MESSAGES);
      } catch {
        return [];
      }
    }),

  /** @deprecated Use sessions */
  saveHistory: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/history"), tags: TAGS } })
    .input(z.object({ messages: z.array(historyMessageSchema).max(MAX_STORED_MESSAGES) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const trimmed = input.messages.slice(-MAX_STORED_MESSAGES);
        await db
          .insert(agentChatHistoryTable)
          .values({ userId: ctx.user.id, messages: trimmed, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: agentChatHistoryTable.userId,
            set: { messages: trimmed, updatedAt: new Date() },
          });
        return { ok: true };
      } catch {
        return { ok: false };
      }
    }),

  /** @deprecated Use deleteSession */
  clearHistory: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: getPath("/history"), tags: TAGS } })
    .input(z.object({}))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx }) => {
      try {
        await db
          .delete(agentChatHistoryTable)
          .where(eq(agentChatHistoryTable.userId, ctx.user.id));
        return { ok: true };
      } catch {
        return { ok: false };
      }
    }),
});
