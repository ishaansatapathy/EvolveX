export type QueueItemKind =
  | "email_send"
  | "email_draft"
  | "draft_send"
  | "calendar_invite"
  | "meeting_bundle"
  | "calendar_archive"
  | "calendar_delete"
  | "calendar_update";

export type DraftSendPayload = {
  draftId: string;
};

export type QueueItemStatus = "pending" | "processing" | "approved" | "dismissed" | "failed";

export type EmailQueuePayload = {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  cc?: string;
  bcc?: string;
};

export type CalendarQueuePayload = {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
  attendeeEmails?: string[];
  allDay?: boolean;
  recurrence?: string[];
};

export type MeetingBundlePayload = {
  email: EmailQueuePayload;
  calendar: CalendarQueuePayload;
};

export type CalendarArchivePayload = {
  eventId: string;
  summary: string;
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
  allDay?: boolean;
  htmlLink?: string;
  recurringEventId?: string;
  editScope?: "instance" | "series" | "following";
};

export type CalendarDeletePayload = {
  eventId: string;
  summary: string;
  htmlLink?: string;
  recurringEventId?: string;
  editScope?: "instance" | "series" | "following";
  cancelWithNotify?: boolean;
};

export type CalendarUpdatePayload = {
  eventId: string;
  summary: string;
  newSummary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
};

export type QueueItem = {
  id: string;
  kind: QueueItemKind;
  title: string;
  preview?: string;
  payload: Record<string, unknown>;
  sourceThreadId?: string;
  status: QueueItemStatus;
  errorMessage?: string;
  createdAt: string;
  resolvedAt?: string;
};

export type QueueEnqueueOrigin = "inbox" | "agent" | "calendar";

export type QueueEnqueueOptions = {
  origin?: QueueEnqueueOrigin;
};

export interface QueueService {
  listItems(userId: string, opts?: { status?: QueueItemStatus | "pending" | "all"; limit?: number }): Promise<QueueItem[]>;
  pendingCount(userId: string): Promise<number>;
  enqueueEmail(
    userId: string,
    input: {
      mode: "send" | "draft";
      email: EmailQueuePayload;
      title?: string;
      preview?: string;
    },
    opts?: QueueEnqueueOptions,
  ): Promise<QueueItem>;
  enqueueCalendarInvite(
    userId: string,
    input: {
      calendar: CalendarQueuePayload;
      title?: string;
      preview?: string;
    },
    opts?: QueueEnqueueOptions,
  ): Promise<QueueItem>;
  enqueueMeetingBundle(
    userId: string,
    input: {
      bundle: MeetingBundlePayload;
      title?: string;
      preview?: string;
      sourceThreadId?: string;
    },
    opts?: QueueEnqueueOptions,
  ): Promise<QueueItem>;
  enqueueCalendarArchive(
    userId: string,
    input: {
      archive: CalendarArchivePayload;
      title?: string;
      preview?: string;
    },
    opts?: QueueEnqueueOptions,
  ): Promise<QueueItem>;
  enqueueCalendarDelete(
    userId: string,
    input: {
      delete: CalendarDeletePayload;
      title?: string;
      preview?: string;
    },
    opts?: QueueEnqueueOptions,
  ): Promise<QueueItem>;
  enqueueCalendarUpdate(
    userId: string,
    input: {
      update: CalendarUpdatePayload;
      title?: string;
      preview?: string;
    },
    opts?: QueueEnqueueOptions,
  ): Promise<QueueItem>;
  enqueueQuickAddCalendar(
    userId: string,
    input: { text: string; title?: string; preview?: string },
    opts?: QueueEnqueueOptions,
  ): Promise<QueueItem>;
  enqueueDraftSend(
    userId: string,
    input: { draftId: string; title?: string; preview?: string },
    opts?: QueueEnqueueOptions,
  ): Promise<QueueItem>;
  approve(
    userId: string,
    itemId: string,
    opts?: {
      archive?: { startDateTime: string; endDateTime: string; timeZone?: string };
    },
  ): Promise<QueueItem>;
  dismiss(userId: string, itemId: string): Promise<QueueItem>;
  getStats(userId: string): Promise<{
    total: number;
    pending: number;
    approved: number;
    dismissed: number;
    failed: number;
    byKind: Record<string, number>;
    timeline: { date: string; queued: number; approved: number; dismissed: number }[];
  }>;
}

let queueService: QueueService | null = null;

export function registerQueueService(service: QueueService) {
  queueService = service;
}

export function getQueueService(): QueueService {
  if (!queueService) {
    throw new Error("Queue service is not registered");
  }
  return queueService;
}
