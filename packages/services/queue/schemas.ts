import { z } from "zod";

import {
  emailBodySchema,
  safeEmailSubjectSchema,
  singleRecipientSchema,
} from "../validation/email";

export const emailAttachmentSchema = z.object({
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(100),
  contentBase64: z.string().min(1).max(8_000_000),
});

export const emailQueuePayloadSchema = z.object({
  to: singleRecipientSchema,
  subject: safeEmailSubjectSchema,
  body: emailBodySchema,
  threadId: z.string().optional(),
  /** Optional CC recipient (single address for now — comma-separated multi not yet supported). */
  cc: z.string().email().optional(),
  /** Optional BCC recipient (kept server-side; never shown in previews to the user). */
  bcc: z.string().email().optional(),
  attachments: z.array(emailAttachmentSchema).max(5).optional(),
});

export const calendarQueuePayloadSchema = z
  .object({
    summary: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    location: z.string().max(500).optional(),
    startDateTime: z.string().min(1).refine((v) => !Number.isNaN(Date.parse(v)), {
      message: "Invalid start date/time",
    }),
    endDateTime: z.string().min(1).refine((v) => !Number.isNaN(Date.parse(v)), {
      message: "Invalid end date/time",
    }),
    timeZone: z.string().max(64).optional(),
    attendeeEmails: z.array(z.string().email()).max(20).optional(),
    allDay: z.boolean().optional(),
    /** Google Calendar RRULE strings, e.g. ["RRULE:FREQ=WEEKLY"] */
    recurrence: z.array(z.string().max(200)).max(5).optional(),
  })
  .refine((d) => Date.parse(d.endDateTime) > Date.parse(d.startDateTime), {
    message: "End date/time must be after start date/time",
    path: ["endDateTime"],
  });

export const calendarArchivePayloadSchema = z.object({
  eventId: z.string().min(1),
  summary: z.string().min(1).max(200),
  startDateTime: z.string().min(1),
  endDateTime: z.string().min(1),
  timeZone: z.string().max(64).optional(),
  allDay: z.boolean().optional(),
  htmlLink: z.string().optional(),
  recurringEventId: z.string().optional(),
  editScope: z.enum(["instance", "series", "following"]).optional(),
});

export const calendarDeletePayloadSchema = z.object({
  eventId: z.string().min(1),
  summary: z.string().min(1).max(200),
  htmlLink: z.string().optional(),
  recurringEventId: z.string().optional(),
  editScope: z.enum(["instance", "series", "following"]).optional(),
  /** When true, approve calls cancel (notify attendees) instead of hard delete. */
  cancelWithNotify: z.boolean().optional(),
});

export const calendarUpdatePayloadSchema = z
  .object({
    eventId: z.string().min(1),
    summary: z.string().min(1).max(200),
    newSummary: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    location: z.string().max(500).optional(),
    htmlLink: z.string().optional(),
  })
  .refine((d) => Boolean(d.newSummary ?? d.description ?? d.location), {
    message: "At least one of newSummary, description, or location is required",
  });

export const draftSendPayloadSchema = z.object({
  draftId: z.string().min(1).max(128),
});

export const meetingBundlePayloadSchema = z.object({
  email: emailQueuePayloadSchema,
  calendar: calendarQueuePayloadSchema,
});

export function parseEmailQueuePayload(payload: Record<string, unknown>) {
  return emailQueuePayloadSchema.parse(payload);
}

export function parseCalendarQueuePayload(payload: Record<string, unknown>) {
  return calendarQueuePayloadSchema.parse(payload);
}

export function parseCalendarArchivePayload(payload: Record<string, unknown>) {
  return calendarArchivePayloadSchema.parse(payload);
}

export function parseCalendarDeletePayload(payload: Record<string, unknown>) {
  return calendarDeletePayloadSchema.parse(payload);
}

export function parseCalendarUpdatePayload(payload: Record<string, unknown>) {
  return calendarUpdatePayloadSchema.parse(payload);
}

export function parseDraftSendPayload(payload: Record<string, unknown>) {
  return draftSendPayloadSchema.parse(payload);
}

export function parseMeetingBundlePayload(payload: Record<string, unknown>) {
  return meetingBundlePayloadSchema.parse(payload);
}
