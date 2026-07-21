import { z } from "zod";

import { getCalendarService } from "@repo/services/calendar";
import { getQueueService } from "@repo/services/queue";
import { calendarUpdatePayloadSchema } from "@repo/services/queue/schemas";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Calendar"];
const getPath = generatePath("/calendar");

const connectionStateSchema = z.enum([
  "connected",
  "missing_credentials",
  "not_connected",
  "not_configured",
]);

const calendarAttendeeSchema = z.object({
  email: z.string().optional(),
  displayName: z.string().optional(),
  responseStatus: z.string().optional(),
  organizer: z.boolean().optional(),
  optional: z.boolean().optional(),
});

const calendarEventSchema = z.object({
  id: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  allDay: z.boolean().optional(),
  htmlLink: z.string().optional(),
  hangoutLink: z.string().optional(),
  status: z.string().optional(),
  recurringEventId: z.string().optional(),
  isRecurring: z.boolean().optional(),
  attendees: z.array(calendarAttendeeSchema).optional(),
});

const isoDateTimeSchema = z.string().min(1);

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

export const calendarRouter = router({
  connectionStatus: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/connection-status"), tags: TAGS } })
    .input(z.object({}))
    .output(
      z.object({
        googlecalendar: connectionStateSchema,
      }),
    )
    .query(async ({ ctx }) => {
      const calendar = getCalendarService();
      return calendar.getConnectionStatus(ctx.user.id);
    }),

  listEvents: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/events"), tags: TAGS } })
    .input(
      z.object({
        timeMin: isoDateTimeSchema,
        timeMax: isoDateTimeSchema,
        maxResults: z.number().int().min(1).max(250).optional(),
        timeZone: z.string().max(64).optional(),
        pageToken: z.string().optional(),
        /** Free-text search across event title, description, and attendees. */
        q: z.string().max(200).optional(),
      }),
    )
    .output(
      z.object({
        events: z.array(calendarEventSchema),
        nextPageToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const calendar = getCalendarService();
        return await calendar.listEvents(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  quickAddEvent: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/events/quick-add"), tags: TAGS } })
    .input(
      z.object({
        /** Natural language text — parsed locally, then queued for approval before events.create. */
        text: z.string().min(1).max(500),
      }),
    )
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const queue = getQueueService();
        return await queue.enqueueQuickAddCalendar(ctx.user.id, { text: input.text }, { origin: "calendar" });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  getEvent: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/events/{eventId}"), tags: TAGS } })
    .input(z.object({ eventId: z.string().min(1) }))
    .output(calendarEventSchema.nullable())
    .query(async ({ ctx, input }) => {
      try {
        const calendar = getCalendarService();
        return await calendar.getEvent(ctx.user.id, input.eventId);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  rescheduleEvent: protectedProcedure
    .meta({ openapi: { method: "PATCH", path: getPath("/events/{eventId}/reschedule"), tags: TAGS } })
    .input(
      z.object({
        eventId: z.string().min(1),
        startDateTime: isoDateTimeSchema,
        endDateTime: isoDateTimeSchema,
        timeZone: z.string().max(64).optional(),
        allDay: z.boolean().optional(),
        editScope: z.enum(["instance", "series", "following"]).optional(),
        recurringEventId: z.string().optional(),
      }),
    )
    .output(calendarEventSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        if (Number.isNaN(Date.parse(input.startDateTime)) || Number.isNaN(Date.parse(input.endDateTime))) {
          throw new Error("Invalid ISO date/time");
        }
        if (Date.parse(input.endDateTime) <= Date.parse(input.startDateTime)) {
          throw new Error("End date/time must be after start date/time");
        }
        const calendar = getCalendarService();
        return await calendar.updateEventTimes(
          ctx.user.id,
          input.eventId,
          { startDateTime: input.startDateTime, endDateTime: input.endDateTime, timeZone: input.timeZone, allDay: input.allDay },
          { editScope: input.editScope, recurringEventId: input.recurringEventId },
        );
      } catch (error) {
        mapServiceError(error);
      }
    }),

  patchEventDetails: protectedProcedure
    .meta({ openapi: { method: "PATCH", path: getPath("/events/{eventId}/details"), tags: TAGS } })
    .input(
      z.object({
        eventId: z.string().min(1),
        summary: z.string().max(200).optional(),
        description: z.string().max(5000).optional(),
        location: z.string().max(500).optional(),
      }),
    )
    .output(calendarEventSchema.nullable())
    .mutation(async ({ ctx, input }) => {
      try {
        const calendar = getCalendarService();
        const queue = getQueueService();
        const existing = await calendar.getEvent(ctx.user.id, input.eventId);
        if (!existing) return null;
        const update = calendarUpdatePayloadSchema.parse({
          eventId: input.eventId,
          summary: existing.summary ?? "Event",
          newSummary: input.summary,
          description: input.description,
          location: input.location,
        });
        const item = await queue.enqueueCalendarUpdate(
          ctx.user.id,
          { update, title: `Update: ${existing.summary ?? "Event"}` },
          { origin: "calendar" },
        );
        if (item.status === "approved") {
          return calendar.getEvent(ctx.user.id, input.eventId);
        }
        return existing as z.infer<typeof calendarEventSchema>;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  createEvent: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/events"), tags: TAGS } })
    .input(
      z.object({
        summary: z.string().min(1).max(200),
        description: z.string().max(5000).optional(),
        location: z.string().max(500).optional(),
        startDateTime: isoDateTimeSchema,
        endDateTime: isoDateTimeSchema,
        timeZone: z.string().max(64).optional(),
        attendeeEmails: z.array(z.string().email()).max(20).optional(),
        allDay: z.boolean().optional(),
        /** Auto-add a Google Meet video conference link. Defaults to true when attendees provided. */
        addGoogleMeet: z.boolean().optional(),
        recurrence: z.array(z.string().max(200)).max(5).optional(),
      }),
    )
    .output(calendarEventSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        if (Number.isNaN(Date.parse(input.startDateTime)) || Number.isNaN(Date.parse(input.endDateTime))) {
          throw new Error("Invalid ISO date/time");
        }
        if (Date.parse(input.endDateTime) <= Date.parse(input.startDateTime)) {
          throw new Error("End date/time must be after start date/time");
        }
        const calendar = getCalendarService();
        return await calendar.createEvent(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  cancelEvent: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/events/{eventId}/cancel"), tags: TAGS } })
    .input(z.object({ eventId: z.string().min(1) }))
    .output(z.object({ success: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const calendar = getCalendarService();
        return await calendar.cancelEvent(ctx.user.id, input.eventId);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  deleteEvent: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: getPath("/events/{eventId}"), tags: TAGS } })
    .input(z.object({ eventId: z.string().min(1) }))
    .output(z.object({ success: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const calendar = getCalendarService();
        return await calendar.deleteEvent(ctx.user.id, input.eventId);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  checkFreeBusy: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/free-busy"), tags: TAGS } })
    .input(
      z.object({
        startDateTime: isoDateTimeSchema,
        endDateTime: isoDateTimeSchema,
        timeZone: z.string().max(64).optional(),
      }),
    )
    .output(z.object({ conflicts: z.array(calendarEventSchema) }))
    .mutation(async ({ ctx, input }) => {
      try {
        if (Number.isNaN(Date.parse(input.startDateTime)) || Number.isNaN(Date.parse(input.endDateTime))) {
          throw new Error("Invalid ISO date/time");
        }
        if (Date.parse(input.endDateTime) <= Date.parse(input.startDateTime)) {
          throw new Error("End date/time must be after start date/time");
        }
        const calendar = getCalendarService();
        return await calendar.checkFreeBusy(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  respondToEvent: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/events/{eventId}/rsvp"), tags: TAGS } })
    .input(
      z.object({
        eventId: z.string().min(1),
        response: z.enum(["accepted", "declined", "tentative"]),
      }),
    )
    .output(calendarEventSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const calendar = getCalendarService();
        return await calendar.respondToEvent(ctx.user.id, input.eventId, input.response);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  disconnectCalendar: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/disconnect"), tags: TAGS } })
    .input(z.object({}))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx }) => {
      try {
        const calendar = getCalendarService();
        await calendar.disconnect(ctx.user.id);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  searchEventsDb: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/db/events/search"), tags: TAGS } })
    .input(
      z.object({
        query: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .output(z.object({ events: z.array(calendarEventSchema) }))
    .query(async ({ ctx, input }) => {
      const calendar = getCalendarService();
      return calendar.searchEventsDb(ctx.user.id, input);
    }),

  searchCalendarsDb: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/db/calendars/search"), tags: TAGS } })
    .input(
      z.object({
        query: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .output(
      z.object({
        calendars: z.array(
          z.object({ id: z.string(), summary: z.string().optional(), timeZone: z.string().optional() }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const calendar = getCalendarService();
      return calendar.searchCalendarsDb(ctx.user.id, input);
    }),
});
