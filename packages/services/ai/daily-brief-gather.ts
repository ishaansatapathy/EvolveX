import type { CalendarEvent } from "../calendar";
import type { InboxThread } from "../inbox";
import {
  daysSince,
  extractEmailAddress,
  findFocusWindows,
  formatLocalTimeRange,
  normalizeEmail,
  zonedDayRange,
  zonedWallTimeToIso,
  type FocusWindow,
} from "./daily-brief-time";
import { fenceEmailData } from "./agent-guard";
import { getCalendarService } from "../calendar";
import { getInboxService } from "../inbox";
import { getQueueService } from "../queue";
import { rankInboxThreads } from "./inbox-priority";
import { isOpenAiConfigured } from "./openai";

export type BriefThreadSnapshot = {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date?: string;
  unread?: boolean;
  awaitingReply?: boolean;
  daysWaiting?: number | null;
  lastMessageFrom?: string;
};

export type BriefMeetingSnapshot = {
  id: string;
  summary: string;
  start?: string;
  end?: string;
  needsPrep: boolean;
  relatedEmailCount: number;
  attendeeNames: string[];
};

export type BriefWaitingThread = {
  id: string;
  subject: string;
  to: string;
  sentDaysAgo: number;
};

export type BriefGatherResult = {
  userName: string;
  userEmail?: string;
  timeZone: string;
  gmailConnected: boolean;
  calendarConnected: boolean;
  threads: BriefThreadSnapshot[];
  rankedThreadIds: string[];
  meetings: BriefMeetingSnapshot[];
  focusWindows: FocusWindow[];
  focusWindowLabel?: string;
  pendingQueue: Array<{ id: string; title: string; kind: string }>;
  deadlineThreadIds: string[];
  invoiceThreadIds: string[];
  waitingOn: BriefWaitingThread[];
};

const DETAIL_THREAD_LIMIT = 6;
const MEETING_PREP_SEARCH_LIMIT = 3;

function displayNameFromEmail(email?: string, displayName?: string | null): string {
  if (displayName?.trim()) return displayName.trim();
  if (!email) return "there";
  const local = email.split("@")[0] ?? "there";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function threadSnapshot(thread: InboxThread, extra?: Partial<BriefThreadSnapshot>): BriefThreadSnapshot {
  return {
    id: thread.id,
    subject: thread.subject?.trim() || "No subject",
    from: thread.fromName?.trim() || thread.from?.trim() || "Unknown sender",
    snippet: thread.snippet?.trim() || "",
    date: thread.date,
    unread: thread.unread,
    ...extra,
  };
}

function meetingNeedsPrep(event: CalendarEvent): boolean {
  const description = event.description?.trim() ?? "";
  if (description.length < 24) return true;
  return !/(agenda|prep|discuss|goal|objective|talking point)/i.test(description);
}

function isAwaitingUserReply(
  thread: InboxThread,
  userEmail?: string,
): { awaiting: boolean; daysWaiting: number | null; lastMessageFrom?: string } {
  const messages = thread.messages ?? [];
  if (messages.length === 0) {
    return { awaiting: Boolean(thread.unread), daysWaiting: daysSince(thread.date), lastMessageFrom: thread.from };
  }

  const last = messages[messages.length - 1]!;
  const lastFrom = extractEmailAddress(last.from) ?? last.from ?? "";
  const user = normalizeEmail(userEmail);

  if (user && lastFrom && normalizeEmail(lastFrom) === user) {
    return { awaiting: false, daysWaiting: null, lastMessageFrom: last.from };
  }

  return {
    awaiting: true,
    daysWaiting: daysSince(last.date ?? thread.date),
    lastMessageFrom: last.from,
  };
}

function dedupeThreads(threads: InboxThread[]): InboxThread[] {
  const map = new Map<string, InboxThread>();
  for (const thread of threads) {
    if (!map.has(thread.id)) map.set(thread.id, thread);
  }
  return [...map.values()];
}

function buildMeetingSearchQuery(event: CalendarEvent): string | null {
  const summary = event.summary?.trim();
  const attendee = event.attendees?.find((a) => a.email && !a.organizer)?.email?.trim();
  if (summary && summary.length > 2) {
    return `newer_than:30d subject:"${summary.replace(/"/g, "")}"`;
  }
  if (attendee) {
    return `newer_than:30d from:${attendee}`;
  }
  return null;
}

export async function gatherDailyBriefContext(input: {
  tenantId: string;
  userEmail?: string;
  displayName?: string | null;
  timeZone?: string;
  /** Thread IDs the user has dismissed from previous briefs — excluded from this brief. */
  dismissedThreadIds?: string[];
}): Promise<BriefGatherResult> {
  const timeZone = input.timeZone?.trim() || "UTC";
  const userName = displayNameFromEmail(input.userEmail, input.displayName);
  const inbox = getInboxService();
  const calendar = getCalendarService();
  const queue = getQueueService();

  const [gmailStatus, calendarStatus, pendingItems] = await Promise.all([
    inbox.getConnectionStatus(input.tenantId),
    calendar.getConnectionStatus(input.tenantId),
    queue.listItems(input.tenantId, { status: "pending" }).catch(() => []),
  ]);

  const gmailConnected = gmailStatus.gmail === "connected";
  const calendarConnected = calendarStatus.googlecalendar === "connected";

  const day = zonedDayRange(timeZone);

  const cachedThreadsPromise = gmailConnected
    ? Promise.resolve({ threads: [] as InboxThread[] })
    : inbox.listCachedThreads(input.tenantId, { limit: 30 }).catch(() => ({ threads: [] as InboxThread[] }));

  // Recent unread personal mail only — promotions/social/notifications excluded.
  const unreadPromise = gmailConnected
    ? inbox
        .listThreads(input.tenantId, {
          maxResults: 20,
          query:
            "in:inbox is:unread newer_than:3d -category:promotions -category:social -category:updates -category:forums",
        })
        .catch(() => ({ threads: [] as InboxThread[] }))
    : cachedThreadsPromise.then(({ threads }) => ({
        threads: threads.filter((t) => t.unread !== false),
      }));

  const deadlinePromise = gmailConnected
    ? inbox
        .listThreads(input.tenantId, {
          maxResults: 8,
          query:
            'in:inbox is:unread newer_than:7d -category:promotions -category:social (deadline OR "due date" OR "by EOD" OR urgent OR "action required")',
        })
        .catch(() => ({ threads: [] as InboxThread[] }))
    : cachedThreadsPromise.then(({ threads }) => ({
        threads: threads.filter((t) =>
          /deadline|due date|by eod|urgent|action required|corsair|hackathon/i.test(
            `${t.subject ?? ""} ${t.snippet ?? ""}`,
          ),
        ),
      }));

  const invoicePromise = gmailConnected
    ? inbox
        .listThreads(input.tenantId, {
          maxResults: 5,
          query:
            'in:inbox is:unread newer_than:14d -category:promotions (invoice OR unpaid OR "payment due")',
        })
        .catch(() => ({ threads: [] as InboxThread[] }))
    : Promise.resolve({ threads: [] as InboxThread[] });

  const demoCalendarEvents = (): CalendarEvent[] => {
    const base = new Date();
    base.setSeconds(0, 0);
    const start = new Date(base);
    start.setHours(11, 0, 0, 0);
    const end = new Date(start);
    end.setHours(12, 0, 0, 0);
    const focusStart = new Date(base);
    focusStart.setHours(15, 0, 0, 0);
    const focusEnd = new Date(focusStart);
    focusEnd.setHours(16, 0, 0, 0);
    return [
      {
        id: "demo-cal-brief-1",
        summary: "Corsair Hackathon Demo",
        start: start.toISOString(),
        end: end.toISOString(),
        status: "confirmed",
        attendees: [{ email: "judge@corsair.dev", displayName: "Judge" }],
      },
      {
        id: "demo-cal-brief-2",
        summary: "Focus block — deep work",
        start: focusStart.toISOString(),
        end: focusEnd.toISOString(),
        status: "confirmed",
      },
    ];
  };

  const eventsPromise = calendarConnected
    ? calendar
        .listEvents(input.tenantId, {
          timeMin: day.timeMin,
          timeMax: day.timeMax,
          maxResults: 25,
          timeZone,
        })
        .catch(() => ({ events: [] as CalendarEvent[] }))
    : Promise.resolve({ events: demoCalendarEvents() });

  const freeBusyPromise = calendarConnected
    ? calendar
        .checkFreeBusy(input.tenantId, {
          startDateTime: day.timeMin,
          endDateTime: day.timeMax,
          timeZone,
        })
        .catch(() => ({ conflicts: [] as CalendarEvent[] }))
    : Promise.resolve({ conflicts: [] as CalendarEvent[] });

  // Waiting on others — sent mail with no reply in last 5 days.
  const waitingOnPromise = gmailConnected
    ? inbox
        .listThreads(input.tenantId, {
          maxResults: 8,
          query: "in:sent newer_than:5d -category:promotions",
        })
        .catch(() => ({ threads: [] as InboxThread[] }))
    : Promise.resolve({ threads: [] as InboxThread[] });

  const [unreadList, deadlineList, invoiceList, eventsResult, freeBusyResult, waitingOnList] =
    await Promise.all([
      unreadPromise,
      deadlinePromise,
      invoicePromise,
      eventsPromise,
      freeBusyPromise,
      waitingOnPromise,
    ]);

  // Unread-only for email signals — read mail (e.g. opened from notification) drops off the brief.
  const merged = dedupeThreads([
    ...unreadList.threads,
    ...deadlineList.threads,
    ...invoiceList.threads,
  ]);

  const dismissedSet = new Set(input.dismissedThreadIds ?? []);
  const filteredMerged = dismissedSet.size > 0
    ? merged.filter((t) => !dismissedSet.has(t.id))
    : merged;

  let rankedThreadIds = filteredMerged.map((t) => t.id);
  const canRank =
    filteredMerged.length > 1 && isOpenAiConfigured() && (gmailConnected || filteredMerged.length > 0);
  if (canRank) {
    try {
      rankedThreadIds = await rankInboxThreads(
        filteredMerged.slice(0, 20).map((t) => ({
          id: t.id,
          snippet: t.snippet,
          subject: t.subject,
          from: t.fromName ?? t.from,
        })),
      );
    } catch {
      rankedThreadIds = filteredMerged.map((t) => t.id);
    }
  }

  const detailIds = rankedThreadIds.slice(0, DETAIL_THREAD_LIMIT);
  const cachedById = new Map(filteredMerged.map((t) => [t.id, t]));
  const detailThreads = gmailConnected
    ? await Promise.all(
        detailIds.map(async (id) => {
          try {
            return await inbox.getThread(input.tenantId, id, { userEmail: input.userEmail });
          } catch {
            return null;
          }
        }),
      )
    : detailIds.map((id) => cachedById.get(id) ?? null);

  // Build a set of thread IDs where user already sent a reply (from sent folder).
  // If a thread is in waitingOn, the user already replied — don't mark as awaitingReply.
  const userRepliedThreadIds = new Set(waitingOnList.threads.map((t) => t.id));

  const threadSnapshots: BriefThreadSnapshot[] = [];
  for (const thread of detailThreads) {
    if (!thread) continue;
    if (gmailConnected && !thread.unread) continue;
    const reply = isAwaitingUserReply(thread, input.userEmail);
    // If the sent-folder cross-check shows user already replied, override awaitingReply.
    const alreadyReplied = userRepliedThreadIds.has(thread.id);
    threadSnapshots.push(
      threadSnapshot(thread, {
        awaitingReply: alreadyReplied ? false : reply.awaiting,
        daysWaiting: alreadyReplied ? null : reply.daysWaiting,
        lastMessageFrom: reply.lastMessageFrom,
      }),
    );
  }

  const todayEvents = (eventsResult.events ?? []).filter((e) => e.status !== "cancelled");
  const prepCandidates = todayEvents.filter(meetingNeedsPrep).slice(0, MEETING_PREP_SEARCH_LIMIT);

  const relatedCounts = await Promise.all(
    prepCandidates.map(async (event) => {
      const query = buildMeetingSearchQuery(event);
      if (!query || !gmailConnected) return 0;
      try {
        const found = await inbox.listThreads(input.tenantId, { maxResults: 5, query });
        return found.threads.length;
      } catch {
        return 0;
      }
    }),
  );

  const meetings: BriefMeetingSnapshot[] = todayEvents.map((event) => {
    const prepIndex = prepCandidates.findIndex((c) => c.id === event.id);
    return {
      id: event.id,
      summary: event.summary?.trim() || "Untitled meeting",
      start: event.start,
      end: event.end,
      needsPrep: meetingNeedsPrep(event),
      relatedEmailCount: prepIndex >= 0 ? relatedCounts[prepIndex] ?? 0 : 0,
      attendeeNames: (event.attendees ?? [])
        .map((a) => a.displayName?.trim() || a.email?.split("@")[0] || "")
        .filter(Boolean)
        .slice(0, 4),
    };
  });

  const busySlots = (freeBusyResult.conflicts ?? []).map((slot) => ({
    start: slot.start ?? day.timeMin,
    end: slot.end ?? day.timeMax,
  }));

  const focusWindows = findFocusWindows({
    dayStartIso: zonedWallTimeToIso(day.dateKey, "09:00:00", timeZone),
    dayEndIso: zonedWallTimeToIso(day.dateKey, "18:00:00", timeZone),
    busySlots,
    minMinutes: 90,
  });

  const focusWindowLabel =
    focusWindows[0] != null
      ? formatLocalTimeRange(focusWindows[0].startIso, focusWindows[0].endIso, timeZone)
      : undefined;

  return {
    userName,
    userEmail: input.userEmail,
    timeZone,
    gmailConnected,
    calendarConnected,
    threads: threadSnapshots,
    rankedThreadIds,
    meetings,
    focusWindows,
    focusWindowLabel,
    pendingQueue: pendingItems.slice(0, 8).map((item) => ({
      id: item.id,
      title: item.title,
      kind: item.kind,
    })),
    deadlineThreadIds: deadlineList.threads.map((t) => t.id).filter((id) => !dismissedSet.has(id)),
    invoiceThreadIds: invoiceList.threads.map((t) => t.id).filter((id) => !dismissedSet.has(id)),
    waitingOn: waitingOnList.threads
      .filter((t) => {
        // Only include if the last message was from us (i.e. they haven't replied).
        const messages = t.messages ?? [];
        if (messages.length === 0) return daysSince(t.date) != null;
        const last = messages[messages.length - 1]!;
        const lastFrom = extractEmailAddress(last.from) ?? "";
        const user = normalizeEmail(input.userEmail) ?? "";
        return user && lastFrom.includes(user);
      })
      .slice(0, 5)
      .map((t) => ({
        id: t.id,
        subject: t.subject?.trim() || "No subject",
        to: t.to?.trim() || "Unknown",
        sentDaysAgo: daysSince(t.date) ?? 0,
      })),
  };
}

export function serializeGatherForModel(context: BriefGatherResult): string {
  const lines: string[] = [
    `User: ${context.userName}`,
    `Timezone: ${context.timeZone}`,
    `Gmail connected: ${context.gmailConnected}`,
    `Calendar connected: ${context.calendarConnected}`,
  ];

  if (context.focusWindowLabel) {
    lines.push(`Best focus window today: ${context.focusWindowLabel}`);
  }

  if (context.pendingQueue.length > 0) {
    lines.push("", "Pending approval queue:");
    for (const item of context.pendingQueue) {
      lines.push(`- [${item.kind}] ${item.title} (queueId=${item.id})`);
    }
  }

  if (context.threads.length > 0) {
    const deadlineSet = new Set(context.deadlineThreadIds);
    const invoiceSet = new Set(context.invoiceThreadIds);
    lines.push("", "Email threads (most important first):");
    for (const thread of context.threads) {
      const waiting =
        thread.awaitingReply && thread.daysWaiting != null
          ? ` | awaiting reply ${thread.daysWaiting}d`
          : thread.awaitingReply
            ? " | awaiting reply"
            : "";
      const tags: string[] = [];
      if (deadlineSet.has(thread.id)) tags.push("DEADLINE");
      if (invoiceSet.has(thread.id)) tags.push("INVOICE");
      const tagStr = tags.length > 0 ? ` | [${tags.join(",")}]` : "";
      lines.push(
        `- id=${thread.id} | from=${thread.from} | subject=${thread.subject}${waiting}${tagStr}`,
      );
      if (thread.snippet) lines.push(`  snippet: ${fenceEmailData(thread.snippet.slice(0, 180))}`);
    }
  }

  // Surface deadline/invoice threads that weren't in the top-detail window but are still important.
  const detailIds = new Set(context.threads.map((t) => t.id));
  const extraDeadlines = context.deadlineThreadIds.filter((id) => !detailIds.has(id));
  const extraInvoices = context.invoiceThreadIds.filter((id) => !detailIds.has(id));
  if (extraDeadlines.length > 0) {
    lines.push("", `Deadline/urgent threads not in detail (IDs only): ${extraDeadlines.join(", ")}`);
  }
  if (extraInvoices.length > 0) {
    lines.push("", `Invoice/payment threads not in detail (IDs only): ${extraInvoices.join(", ")}`);
  }

  if (context.meetings.length > 0) {
    lines.push("", "Today's calendar events:");
    for (const meeting of context.meetings) {
      const prep = meeting.needsPrep ? " | needs prep" : "";
      const related =
        meeting.relatedEmailCount > 0 ? ` | ${meeting.relatedEmailCount} related emails` : "";
      lines.push(
        `- id=${meeting.id} | ${meeting.summary} | start=${meeting.start ?? "?"}${prep}${related}`,
      );
      if (meeting.attendeeNames.length > 0) {
        lines.push(`  attendees: ${meeting.attendeeNames.join(", ")}`);
      }
    }
  }

  if (context.waitingOn.length > 0) {
    lines.push("", "Waiting on replies (user sent, no response yet):");
    for (const w of context.waitingOn) {
      lines.push(`- id=${w.id} | to=${w.to} | subject=${w.subject} | sent ${w.sentDaysAgo}d ago`);
    }
  }

  if (!context.gmailConnected && !context.calendarConnected) {
    lines.push("", "Demo workspace — sample mail and calendar data. Suggest connecting Gmail and Calendar for live sync.");
  } else if (!context.gmailConnected && context.threads.length > 0) {
    lines.push("", "Gmail not connected — using demo inbox cache.");
  } else if (!context.calendarConnected && context.meetings.length > 0) {
    lines.push("", "Calendar not connected — using demo calendar preview.");
  }

  return lines.join("\n");
}
