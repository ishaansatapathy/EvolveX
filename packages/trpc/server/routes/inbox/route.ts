import { z } from "zod";

import { getInboxService } from "@repo/services/inbox";
import {
  emailBodySchema,
  safeEmailSubjectSchema,
  singleRecipientSchema,
} from "@repo/services/validation/email";

import { TRPCError } from "@trpc/server";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Inbox"];
const getPath = generatePath("/inbox");

const inboxMessageSchema = z.object({
  id: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  date: z.string().optional(),
  body: z.string(),
  bodyHtml: z.string().optional(),
  snippet: z.string(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        mimeType: z.string(),
        size: z.number(),
        attachmentId: z.string().optional(),
      }),
    )
    .optional(),
});

const inboxThreadSchema = z.object({
  id: z.string(),
  snippet: z.string(),
  historyId: z.string().optional(),
  subject: z.string().optional(),
  from: z.string().optional(),
  fromName: z.string().optional(),
  to: z.string().optional(),
  date: z.string().optional(),
  body: z.string().optional(),
  messageId: z.string().optional(),
  messages: z.array(inboxMessageSchema).optional(),
  suggestedReplyTo: z.string().optional(),
  messageCount: z.number().optional(),
  unread: z.boolean().optional(),
  labelIds: z.array(z.string()).optional(),
});

const inboxDraftSchema = z.object({
  id: z.string(),
  messageId: z.string().optional(),
  threadId: z.string().optional(),
  subject: z.string().optional(),
  to: z.string().optional(),
  snippet: z.string(),
  updatedAt: z.string().optional(),
});

const connectionStatusSchema = z.object({
  gmail: z.enum(["connected", "missing_credentials", "not_connected", "not_configured"]),
});

const composeInputSchema = z.object({
  to: singleRecipientSchema,
  subject: safeEmailSubjectSchema,
  body: emailBodySchema,
  threadId: z.string().optional(),
});

function assertDirectSendAllowed() {
  if (process.env.THREAD_ALLOW_DIRECT_SEND?.trim() !== "true") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Direct send is disabled. Add the action to the approval queue instead.",
    });
  }
}

export const inboxRouter = router({
  connectionStatus: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/connection-status"), tags: TAGS } })
    .input(z.object({}))
    .output(connectionStatusSchema)
    .query(async ({ ctx }) => {
      const inbox = getInboxService();
      return inbox.getConnectionStatus(ctx.user.id);
    }),

  listThreads: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/threads"), tags: TAGS } })
    .input(
      z.object({
        maxResults: z.number().int().min(1).max(100).optional(),
        pageToken: z.string().optional(),
        query: z.string().trim().max(512).optional(),
        refresh: z.boolean().optional(),
      }),
    )
    .output(
      z.object({
        threads: z.array(inboxThreadSchema),
        nextPageToken: z.string().optional(),
        stale: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        return await inbox.listThreads(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  listCachedThreads: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/threads/cached"), tags: TAGS } })
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).optional(),
        query: z.string().trim().max(512).optional(),
      }),
    )
    .output(z.object({ threads: z.array(inboxThreadSchema) }))
    .query(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        return await inbox.listCachedThreads(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  listDrafts: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/drafts"), tags: TAGS } })
    .input(
      z.object({
        maxResults: z.number().int().min(1).max(100).optional(),
        pageToken: z.string().optional(),
      }),
    )
    .output(
      z.object({
        drafts: z.array(inboxDraftSchema),
        nextPageToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        return await inbox.listDrafts(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  getDraft: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/drafts/{draftId}"), tags: TAGS } })
    .input(z.object({ draftId: z.string().min(1) }))
    .output(
      z
        .object({
          id: z.string(),
          to: z.string().optional(),
          subject: z.string().optional(),
          body: z.string(),
          threadId: z.string().optional(),
        })
        .nullable(),
    )
    .query(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        return await inbox.getDraft(ctx.user.id, input.draftId);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  getThread: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/threads/{threadId}"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(inboxThreadSchema.nullable())
    .query(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        return await inbox.getThread(ctx.user.id, input.threadId, { userEmail: ctx.user.email });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  sendMessage: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/send"), tags: TAGS } })
    .input(composeInputSchema)
    .output(
      z.object({
        id: z.string().optional(),
        threadId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertDirectSendAllowed();
      try {
        const inbox = getInboxService();
        return await inbox.sendMessage(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  createDraft: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/drafts"), tags: TAGS } })
    .input(composeInputSchema)
    .output(
      z.object({
        id: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        return await inbox.createDraft(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  markThreadRead: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/threads/{threadId}/read"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.markThreadRead(ctx.user.id, input.threadId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  markThreadUnread: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/threads/{threadId}/unread"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.markThreadUnread(ctx.user.id, input.threadId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  archiveThread: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/threads/{threadId}/archive"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.archiveThread(ctx.user.id, input.threadId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  listLabels: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/labels"), tags: TAGS } })
    .input(z.object({}))
    .output(z.array(z.object({ id: z.string(), name: z.string(), type: z.string().optional() })))
    .query(async ({ ctx }) => {
      const inbox = getInboxService();
      return inbox.listLabels(ctx.user.id);
    }),

  createLabel: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/labels"), tags: TAGS } })
    .input(z.object({ name: z.string().trim().min(1).max(200) }))
    .output(z.object({ id: z.string(), name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        const id = await inbox.ensureLabel(ctx.user.id, input.name);
        return { id, name: input.name };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  applyLabel: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/threads/{threadId}/labels"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1), labelId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.applyLabel(ctx.user.id, input.threadId, input.labelId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  removeLabel: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: getPath("/threads/{threadId}/labels/{labelId}"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1), labelId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.removeLabel(ctx.user.id, input.threadId, input.labelId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Star a thread via Corsair Gmail (STARRED label). */
  starThread: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/threads/{threadId}/star"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.starThread(ctx.user.id, input.threadId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Unstar a thread via Corsair Gmail. */
  unstarThread: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: getPath("/threads/{threadId}/star"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.unstarThread(ctx.user.id, input.threadId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Mark thread as important via Corsair Gmail (IMPORTANT label). */
  markImportant: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/threads/{threadId}/important"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.markImportant(ctx.user.id, input.threadId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Remove important flag via Corsair Gmail. */
  markNotImportant: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: getPath("/threads/{threadId}/important"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.markNotImportant(ctx.user.id, input.threadId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  trashThread: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/threads/{threadId}/trash"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.trashThread(ctx.user.id, input.threadId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  deleteDraft: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: getPath("/drafts/{draftId}"), tags: TAGS } })
    .input(z.object({ draftId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.deleteDraft(ctx.user.id, input.draftId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  sendDraft: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/drafts/{draftId}/send"), tags: TAGS } })
    .input(z.object({ draftId: z.string().min(1) }))
    .output(z.object({ id: z.string().optional(), threadId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        return await inbox.sendDraft(ctx.user.id, input.draftId);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  muteThread: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/threads/{threadId}/mute"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.muteThread(ctx.user.id, input.threadId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  unmuteThread: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/threads/{threadId}/unmute"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.unmuteThread(ctx.user.id, input.threadId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  updateDraft: protectedProcedure
    .meta({ openapi: { method: "PUT", path: getPath("/drafts/{draftId}"), tags: TAGS } })
    .input(
      composeInputSchema.extend({
        draftId: z.string().min(1),
      }),
    )
    .output(z.object({ id: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        const { draftId, ...body } = input;
        return await inbox.updateDraft(ctx.user.id, draftId, body);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  getLabel: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/labels/{labelId}"), tags: TAGS } })
    .input(z.object({ labelId: z.string().min(1) }))
    .output(z.object({ id: z.string(), name: z.string(), type: z.string().optional() }).nullable())
    .query(async ({ ctx, input }) => {
      const inbox = getInboxService();
      return inbox.getLabel(ctx.user.id, input.labelId);
    }),

  updateLabel: protectedProcedure
    .meta({ openapi: { method: "PATCH", path: getPath("/labels/{labelId}"), tags: TAGS } })
    .input(
      z.object({
        labelId: z.string().min(1),
        name: z.string().optional(),
        labelListVisibility: z.string().optional(),
        messageListVisibility: z.string().optional(),
      }),
    )
    .output(z.object({ id: z.string(), name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        const { labelId, ...label } = input;
        return await inbox.updateLabel(ctx.user.id, labelId, label);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  deleteLabel: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: getPath("/labels/{labelId}"), tags: TAGS } })
    .input(z.object({ labelId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.deleteLabel(ctx.user.id, input.labelId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  listMessages: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/messages"), tags: TAGS } })
    .input(
      z.object({
        maxResults: z.number().int().min(1).max(100).optional(),
        pageToken: z.string().optional(),
        q: z.string().optional(),
        labelIds: z.array(z.string()).optional(),
      }),
    )
    .output(
      z.object({
        messages: z.array(
          z.object({ id: z.string(), threadId: z.string().optional(), snippet: z.string().optional() }),
        ),
        nextPageToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const inbox = getInboxService();
      return inbox.listMessages(ctx.user.id, input);
    }),

  modifyMessage: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/messages/{messageId}/labels"), tags: TAGS } })
    .input(
      z.object({
        messageId: z.string().min(1),
        addLabelIds: z.array(z.string()).optional(),
        removeLabelIds: z.array(z.string()).optional(),
      }),
    )
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        const { messageId, ...opts } = input;
        await inbox.modifyMessage(ctx.user.id, messageId, opts);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  batchModifyMessages: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/messages/batch-modify"), tags: TAGS } })
    .input(
      z.object({
        ids: z.array(z.string().min(1)).min(1).max(1000),
        addLabelIds: z.array(z.string()).optional(),
        removeLabelIds: z.array(z.string()).optional(),
      }),
    )
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.batchModifyMessages(ctx.user.id, input);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  batchModifyThreads: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/threads/batch-modify"), tags: TAGS } })
    .input(
      z.object({
        threadIds: z.array(z.string().min(1)).min(1).max(100),
        addLabelIds: z.array(z.string()).optional(),
        removeLabelIds: z.array(z.string()).optional(),
      }),
    )
    .output(z.object({ modifiedMessages: z.number() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        return await inbox.batchModifyThreads(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  trashMessage: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/messages/{messageId}/trash"), tags: TAGS } })
    .input(z.object({ messageId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.trashMessage(ctx.user.id, input.messageId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  untrashMessage: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/messages/{messageId}/untrash"), tags: TAGS } })
    .input(z.object({ messageId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.untrashMessage(ctx.user.id, input.messageId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  deleteMessage: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: getPath("/messages/{messageId}"), tags: TAGS } })
    .input(z.object({ messageId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.deleteMessage(ctx.user.id, input.messageId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  deleteThread: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: getPath("/threads/{threadId}"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.deleteThread(ctx.user.id, input.threadId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  untrashThread: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/threads/{threadId}/untrash"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inbox = getInboxService();
        await inbox.untrashThread(ctx.user.id, input.threadId);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  searchThreadsDb: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/db/threads/search"), tags: TAGS } })
    .input(
      z.object({
        query: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .output(z.object({ threads: z.array(inboxThreadSchema) }))
    .query(async ({ ctx, input }) => {
      const inbox = getInboxService();
      return inbox.searchThreadsDb(ctx.user.id, input);
    }),

  searchMessagesDb: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/db/messages/search"), tags: TAGS } })
    .input(
      z.object({
        query: z.string().optional(),
        from: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .output(
      z.object({
        messages: z.array(
          z.object({
            id: z.string(),
            threadId: z.string().optional(),
            subject: z.string().optional(),
            snippet: z.string().optional(),
            from: z.string().optional(),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const inbox = getInboxService();
      return inbox.searchMessagesDb(ctx.user.id, input);
    }),

  searchDraftsDb: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/db/drafts/search"), tags: TAGS } })
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .output(
      z.object({
        drafts: z.array(z.object({ id: z.string(), messageId: z.string().optional() })),
      }),
    )
    .query(async ({ ctx, input }) => {
      const inbox = getInboxService();
      return inbox.searchDraftsDb(ctx.user.id, input);
    }),

  searchLabelsDb: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/db/labels/search"), tags: TAGS } })
    .input(
      z.object({
        name: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .output(
      z.object({
        labels: z.array(z.object({ id: z.string(), name: z.string().optional() })),
      }),
    )
    .query(async ({ ctx, input }) => {
      const inbox = getInboxService();
      return inbox.searchLabelsDb(ctx.user.id, input);
    }),

  disconnectGmail: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/disconnect"), tags: TAGS } })
    .input(z.object({}))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx }) => {
      try {
        const inbox = getInboxService();
        await inbox.disconnect(ctx.user.id);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
