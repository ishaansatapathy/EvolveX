import { z } from "zod";

import { getQueueService } from "@repo/services/queue";
import {
  calendarArchivePayloadSchema,
  calendarDeletePayloadSchema,
  calendarQueuePayloadSchema,
  calendarUpdatePayloadSchema,
  emailQueuePayloadSchema,
} from "@repo/services/queue/schemas";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";
import { invalidateBriefCache } from "../ai/route";

const TAGS = ["Queue"];
const getPath = generatePath("/queue");

const queueItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["email_send", "email_draft", "draft_send", "calendar_invite", "meeting_bundle", "calendar_archive", "calendar_delete", "calendar_update"]),
  title: z.string(),
  preview: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
  sourceThreadId: z.string().optional(),
  status: z.enum(["pending", "processing", "approved", "dismissed", "failed"]),
  errorMessage: z.string().optional(),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
});

export const queueRouter = router({
  pendingCount: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/pending-count"), tags: TAGS } })
    .input(z.object({}))
    .output(z.object({ count: z.number().int() }))
    .query(async ({ ctx }) => {
      try {
        const queue = getQueueService();
        const count = await queue.pendingCount(ctx.user.id);
        return { count };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/items"), tags: TAGS } })
    .input(
      z.object({
        status: z.enum(["pending", "processing", "approved", "dismissed", "failed", "all"]).optional(),
      }),
    )
    .output(z.object({ items: z.array(queueItemSchema) }))
    .query(async ({ ctx, input }) => {
      try {
        const queue = getQueueService();
        const items = await queue.listItems(ctx.user.id, { status: input.status ?? "pending" });
        return { items };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  enqueueEmail: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/enqueue/email"), tags: TAGS } })
    .input(
      z.object({
        mode: z.enum(["send", "draft"]),
        email: emailQueuePayloadSchema,
        title: z.string().max(200).optional(),
        preview: z.string().max(500).optional(),
      }),
    )
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const queue = getQueueService();
        return await queue.enqueueEmail(ctx.user.id, input, { origin: "inbox" });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  enqueueCalendar: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/enqueue/calendar"), tags: TAGS } })
    .input(
      z.object({
        calendar: calendarQueuePayloadSchema,
        title: z.string().max(200).optional(),
        preview: z.string().max(500).optional(),
      }),
    )
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const queue = getQueueService();
        return await queue.enqueueCalendarInvite(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  enqueueMeeting: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/enqueue/meeting"), tags: TAGS } })
    .input(
      z.object({
        email: emailQueuePayloadSchema,
        calendar: calendarQueuePayloadSchema,
        title: z.string().max(200).optional(),
        preview: z.string().max(500).optional(),
        sourceThreadId: z.string().optional(),
      }),
    )
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const queue = getQueueService();
        return await queue.enqueueMeetingBundle(
          ctx.user.id,
          {
            bundle: { email: input.email, calendar: input.calendar },
            title: input.title,
            preview: input.preview,
            sourceThreadId: input.sourceThreadId,
          },
          { origin: "calendar" },
        );
      } catch (error) {
        mapServiceError(error);
      }
    }),

  enqueueCalendarArchive: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/enqueue/calendar-archive"), tags: TAGS } })
    .input(
      z.object({
        archive: calendarArchivePayloadSchema,
        title: z.string().max(200).optional(),
        preview: z.string().max(500).optional(),
      }),
    )
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const queue = getQueueService();
        return await queue.enqueueCalendarArchive(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  enqueueCalendarDelete: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/enqueue/calendar-delete"), tags: TAGS } })
    .input(
      z.object({
        delete: calendarDeletePayloadSchema,
        title: z.string().max(200).optional(),
        preview: z.string().max(500).optional(),
      }),
    )
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const queue = getQueueService();
        return await queue.enqueueCalendarDelete(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  enqueueCalendarUpdate: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/enqueue/calendar-update"), tags: TAGS } })
    .input(
      z.object({
        update: calendarUpdatePayloadSchema,
        title: z.string().max(200).optional(),
        preview: z.string().max(500).optional(),
      }),
    )
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const queue = getQueueService();
        return await queue.enqueueCalendarUpdate(ctx.user.id, input, { origin: "calendar" });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  enqueueQuickAdd: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/enqueue/quick-add"), tags: TAGS } })
    .input(
      z.object({
        text: z.string().trim().min(1).max(500),
        title: z.string().max(200).optional(),
        preview: z.string().max(500).optional(),
      }),
    )
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const queue = getQueueService();
        const item = await queue.enqueueQuickAddCalendar(ctx.user.id, input, { origin: "calendar" });
        invalidateBriefCache(ctx.user.id);
        return item;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  enqueueDraftSend: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/enqueue/draft-send"), tags: TAGS } })
    .input(
      z.object({
        draftId: z.string().trim().min(1).max(128),
        title: z.string().max(200).optional(),
        preview: z.string().max(500).optional(),
      }),
    )
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const queue = getQueueService();
        const item = await queue.enqueueDraftSend(ctx.user.id, input, { origin: "inbox" });
        invalidateBriefCache(ctx.user.id);
        return item;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  approve: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/approve"), tags: TAGS } })
    .input(
      z.object({
        id: z.string().uuid(),
        archive: z
          .object({
            startDateTime: z.string().min(1),
            endDateTime: z.string().min(1),
            timeZone: z.string().max(64).optional(),
          })
          .optional(),
      }),
    )
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const queue = getQueueService();
        const result = await queue.approve(ctx.user.id, input.id, { archive: input.archive });
        // Sending or creating events invalidates the cached brief so the user
        // sees accurate "Needs attention" items when they return to /brief.
        invalidateBriefCache(ctx.user.id);
        return result;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  dismiss: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/dismiss"), tags: TAGS } })
    .input(z.object({ id: z.string().uuid() }))
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const queue = getQueueService();
        const result = await queue.dismiss(ctx.user.id, input.id);
        invalidateBriefCache(ctx.user.id);
        return result;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  stats: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/stats"), tags: TAGS } })
    .input(z.object({}))
    .output(
      z.object({
        total: z.number().int(),
        pending: z.number().int(),
        approved: z.number().int(),
        dismissed: z.number().int(),
        failed: z.number().int(),
        byKind: z.record(z.string(), z.number().int()),
        timeline: z.array(
          z.object({
            date: z.string(),
            queued: z.number().int(),
            approved: z.number().int(),
            dismissed: z.number().int(),
          }),
        ),
      }),
    )
    .query(async ({ ctx }) => {
      try {
        const queue = getQueueService();
        return await queue.getStats(ctx.user.id);
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
