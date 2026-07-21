import { ServiceError } from "../errors";
import { gatherDailyBriefContext, serializeGatherForModel, type BriefGatherResult } from "./daily-brief-gather";
import { formatLocalTimeRange, timeOfDayGreeting } from "./daily-brief-time";
import {
  dailyBriefModelSchema,
  dailyBriefSchema,
  type DailyBrief,
  type DailyBriefAction,
  type DailyBriefItem,
} from "./daily-brief-types";
import { createChatCompletion, isOpenAiConfigured } from "./openai";

const SYSTEM_PROMPT = [
  "You are a personal chief of staff preparing a daily brief for a busy professional.",
  "Use a time-appropriate greeting (morning / afternoon / evening) — never assume it is morning.",
  "Use ONLY the facts provided — never invent emails, meetings, or deadlines.",
  "Rules:",
  "- DO NOT count things ('you have X emails'). Tell the user WHAT to do.",
  "- Pick the single most important action for todaysFocus — be specific (name, subject, deadline).",
  "- needsAttention: only truly actionable unread items. Skip if nothing real.",
  "- If waitingOn data exists, surface the most important one in risks or needsAttention.",
  "- summary: 1 sentence — decisive, not generic. Reference the actual top item.",
  "- Be concise. No fluff. Think Superhuman, not Gmail.",
  "Reference threadId/eventId from the data for every item that has one.",
  "Respond with valid JSON only — no markdown.",
  "",
  "JSON shape:",
  JSON.stringify(
    {
      greeting: "Good morning, Alex",
      summary: "Today looks busy — prioritize the client reply before noon.",
      todaysFocus: {
        headline: "Reply to Acme about contract terms",
        detail: "They asked for confirmation before 11 AM.",
        byTime: "before 11 AM",
        threadId: "thread-id-if-known",
      },
      needsAttention: [
        {
          headline: "Reply pending to vendor",
          detail: "Waiting 2 days",
          urgency: "high",
          threadId: "thread-id",
        },
      ],
      meetingInsights: [
        {
          headline: "Sync with Raj at 4 PM",
          detail: "No prep notes in calendar",
          urgency: "medium",
          eventId: "event-id",
        },
      ],
      focusWindow: {
        label: "2 PM – 5 PM is open for deep work",
        startIso: "2026-06-14T08:30:00.000Z",
        endIso: "2026-06-14T11:30:00.000Z",
      },
      risks: [
        {
          headline: "Invoice from vendor still unanswered",
          detail: "Payment terms may lapse",
          urgency: "high",
          threadId: "thread-id",
        },
      ],
      recommendedActions: [
        {
          id: "action-1",
          label: "Reply now",
          kind: "reply",
          threadId: "thread-id",
        },
      ],
    },
    null,
    2,
  ),
].join("\n");

function sanitizeIds(context: BriefGatherResult, brief: DailyBrief): DailyBrief {
  const threadIds = new Set(context.threads.map((t) => t.id));
  const eventIds = new Set(context.meetings.map((m) => m.id));
  const queueIds = new Set(context.pendingQueue.map((q) => q.id));

  const cleanItem = (item: DailyBriefItem): DailyBriefItem => ({
    ...item,
    threadId: item.threadId && threadIds.has(item.threadId) ? item.threadId : undefined,
    eventId: item.eventId && eventIds.has(item.eventId) ? item.eventId : undefined,
    queueItemId: item.queueItemId && queueIds.has(item.queueItemId) ? item.queueItemId : undefined,
  });

  const cleanAction = (action: DailyBriefAction): DailyBriefAction => ({
    ...action,
    threadId: action.threadId && threadIds.has(action.threadId) ? action.threadId : undefined,
    eventId: action.eventId && eventIds.has(action.eventId) ? action.eventId : undefined,
    queueItemId: action.queueItemId && queueIds.has(action.queueItemId) ? action.queueItemId : undefined,
  });

  return {
    ...brief,
    todaysFocus: cleanItem(brief.todaysFocus) as DailyBrief["todaysFocus"],
    needsAttention: brief.needsAttention.map(cleanItem),
    meetingInsights: brief.meetingInsights.map(cleanItem),
    risks: brief.risks.map(cleanItem),
    recommendedActions: brief.recommendedActions.map(cleanAction),
  };
}

function buildFallbackBrief(context: BriefGatherResult): DailyBrief {
  const awaiting = context.threads.filter((t) => t.awaitingReply);
  const prepMeetings = context.meetings.filter((m) => m.needsPrep);
  const topThread = context.threads[0] ?? awaiting[0];
  const focusWindow = context.focusWindows[0];

  const needsAttention: DailyBriefItem[] = awaiting.slice(0, 4).map((thread) => ({
    headline: `Reply pending: ${thread.subject}`,
    detail:
      thread.daysWaiting != null
        ? `${thread.from} — waiting ${thread.daysWaiting} day${thread.daysWaiting === 1 ? "" : "s"}`
        : thread.from,
    urgency: (thread.daysWaiting ?? 0) >= 2 ? "high" : "medium",
    threadId: thread.id,
  }));

  for (const item of context.pendingQueue.slice(0, 2)) {
    needsAttention.push({
      headline: item.title,
      detail: "Waiting for your approval",
      urgency: "medium",
      queueItemId: item.id,
    });
  }

  const meetingInsights: DailyBriefItem[] = context.meetings.slice(0, 4).map((meeting) => ({
    headline: meeting.summary,
    detail: meeting.needsPrep
      ? "Prep recommended — no agenda in the invite"
      : meeting.relatedEmailCount > 0
        ? `${meeting.relatedEmailCount} related email${meeting.relatedEmailCount === 1 ? "" : "s"} found`
        : undefined,
    urgency: meeting.needsPrep ? "medium" : "low",
    eventId: meeting.id,
  }));

  const risks: DailyBriefItem[] = [];
  if (prepMeetings[0]) {
    risks.push({
      headline: `${prepMeetings[0].summary} may need preparation`,
      detail: "Calendar invite has little or no agenda",
      urgency: "medium",
      eventId: prepMeetings[0].id,
    });
  }
  const stale = awaiting.find((t) => (t.daysWaiting ?? 0) >= 3);
  if (stale) {
    risks.push({
      headline: `${stale.from} hasn't heard back in ${stale.daysWaiting} days`,
      detail: stale.subject,
      urgency: "high",
      threadId: stale.id,
    });
  }

  const topWaiting = context.waitingOn[0];
  if (topWaiting && topWaiting.sentDaysAgo >= 2) {
    risks.push({
      headline: `No reply from ${topWaiting.to} yet`,
      detail: `${topWaiting.subject} — sent ${topWaiting.sentDaysAgo} day${topWaiting.sentDaysAgo === 1 ? "" : "s"} ago`,
      urgency: topWaiting.sentDaysAgo >= 3 ? "high" : "medium",
      threadId: topWaiting.id,
    });
  }

  const recommendedActions: DailyBriefAction[] = [];
  if (topThread) {
    recommendedActions.push({
      id: "reply-primary",
      label: "Reply now",
      kind: "reply",
      threadId: topThread.id,
      agentPrompt: `Reply to "${topThread.subject}" from ${topThread.from}. Draft a thoughtful response and queue it for my approval.`,
    });
  }
  if (prepMeetings[0]) {
    recommendedActions.push({
      id: "prep-meeting",
      label: "Prepare meeting",
      kind: "prepare_meeting",
      eventId: prepMeetings[0].id,
      agentPrompt: `Help me prepare for "${prepMeetings[0].summary}" today. Summarize what I should know and suggest talking points.`,
    });
  }
  if (context.pendingQueue[0]) {
    recommendedActions.push({
      id: "open-queue",
      label: "Review queue",
      kind: "open_queue",
      queueItemId: context.pendingQueue[0].id,
    });
  }

  const summaryParts: string[] = [];
  if (awaiting.length > 0) summaryParts.push("replies are waiting on you");
  if (context.meetings.length > 0) summaryParts.push("meetings need your attention");
  if (summaryParts.length === 0) summaryParts.push("you have a lighter day ahead");

  return dailyBriefSchema.parse({
    greeting: timeOfDayGreeting(context.userName, context.timeZone),
    summary: `Today ${summaryParts.join(" and ")} — start with your highest-impact move.`,
    todaysFocus: {
      headline: topThread
        ? `Reply to ${topThread.from}: ${topThread.subject}`
        : prepMeetings[0]
          ? `Prepare for ${prepMeetings[0].summary}`
          : context.pendingQueue[0]
            ? context.pendingQueue[0].title
            : "Review your inbox and calendar",
      detail: topThread?.snippet?.slice(0, 160) || undefined,
      threadId: topThread?.id,
      eventId: !topThread ? prepMeetings[0]?.id : undefined,
    },
    needsAttention,
    meetingInsights,
    focusWindow:
      focusWindow != null
        ? {
            label: `You're free ${formatLocalTimeRange(focusWindow.startIso, focusWindow.endIso, context.timeZone)} — good time for deep work`,
            startIso: focusWindow.startIso,
            endIso: focusWindow.endIso,
          }
        : undefined,
    risks,
    recommendedActions,
    generatedAt: new Date().toISOString(),
    connections: {
      gmail: context.gmailConnected,
      calendar: context.calendarConnected,
    },
  });
}

async function synthesizeBrief(context: BriefGatherResult): Promise<DailyBrief> {
  if (!isOpenAiConfigured()) {
    return buildFallbackBrief(context);
  }

  const userPayload = serializeGatherForModel(context);

  try {
    const content = await createChatCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            "Prepare today's brief from this data.",
            "If focusWindow times are provided in the data, reuse those ISO timestamps in focusWindow.",
            "",
            userPayload,
          ].join("\n"),
        },
      ],
      { jsonObject: true, temperature: 0.35 },
    );

    const parsed = dailyBriefModelSchema.parse(JSON.parse(content));
    const withMeta = dailyBriefSchema.parse({
      ...parsed,
      generatedAt: new Date().toISOString(),
      connections: {
        gmail: context.gmailConnected,
        calendar: context.calendarConnected,
      },
    });

    return applyGreeting(context, enrichBriefThreadLinks(context, sanitizeIds(context, withMeta)));
  } catch {
    return buildFallbackBrief(context);
  }
}

function linkTodaysFocusThreadId(brief: DailyBrief, context: BriefGatherResult): DailyBrief {
  if (brief.todaysFocus.threadId) return brief;

  const focusHeadline = brief.todaysFocus.headline.toLowerCase().trim();
  for (const item of [...brief.needsAttention, ...brief.risks]) {
    if (!item.threadId) continue;
    const headline = item.headline.toLowerCase().trim();
    if (
      headline === focusHeadline ||
      focusHeadline.includes(headline) ||
      headline.includes(focusHeadline)
    ) {
      return { ...brief, todaysFocus: { ...brief.todaysFocus, threadId: item.threadId } };
    }
  }

  const topThread = context.threads[0];
  if (topThread && /follow up|reply|waiting|response/i.test(brief.todaysFocus.headline)) {
    return { ...brief, todaysFocus: { ...brief.todaysFocus, threadId: topThread.id } };
  }

  return brief;
}

function enrichRecommendedActionThreadIds(brief: DailyBrief): DailyBrief {
  const focusThreadId = brief.todaysFocus.threadId;
  if (!focusThreadId) return brief;

  return {
    ...brief,
    recommendedActions: brief.recommendedActions.map((action) => {
      if (action.threadId || action.eventId || action.queueItemId) return action;
      if (action.kind === "reply" || action.kind === "follow_up") {
        return { ...action, threadId: focusThreadId };
      }
      return action;
    }),
  };
}

function enrichBriefThreadLinks(context: BriefGatherResult, brief: DailyBrief): DailyBrief {
  return enrichRecommendedActionThreadIds(linkTodaysFocusThreadId(brief, context));
}

function applyGreeting(context: BriefGatherResult, brief: DailyBrief): DailyBrief {
  return {
    ...brief,
    greeting: timeOfDayGreeting(context.userName, context.timeZone),
  };
}

export async function generateDailyBrief(input: {
  tenantId: string;
  userEmail?: string;
  displayName?: string | null;
  timeZone?: string;
  dismissedThreadIds?: string[];
}): Promise<DailyBrief> {
  const context = await gatherDailyBriefContext(input);

  const hasBriefData =
    context.threads.length > 0 ||
    context.meetings.length > 0 ||
    context.pendingQueue.length > 0;

  if (!context.gmailConnected && !context.calendarConnected && !hasBriefData) {
    throw new ServiceError(
      "PRECONDITION_FAILED",
      "Connect Gmail or Google Calendar to generate your daily brief.",
    );
  }

  return synthesizeBrief(context);
}

export { gatherDailyBriefContext, type BriefGatherResult };
