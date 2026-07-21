/**
 * Smart Context — for an open email thread, pull:
 *   1. Full thread via Corsair Gmail (messages + sender)
 *   2. Related threads via Corsair Gmail search (subject + sender)
 *   3. Related calendar events via Corsair Calendar (near thread date)
 *   4. OpenAI: why this matters + suggested next action
 */
import { getCalendarService } from "../calendar";
import { getInboxService } from "../inbox";
import { daysSince, extractEmailAddress, normalizeEmail } from "./daily-brief-time";
import { createChatCompletion, isOpenAiConfigured } from "./openai";

export type ThreadContextResult = {
  threadId: string;
  whyMatters: string;
  nextAction: string;
  isFollowUpNeeded: boolean;
  followUpSuggestion?: string;
  relatedThreads: Array<{ id: string; subject: string; from: string; date?: string }>;
  relatedEvents: Array<{ id: string; summary: string; start?: string }>;
  senderInfo: {
    email: string;
    name?: string;
    lastInteractionDaysAgo: number | null;
  } | null;
};

const CONTEXT_SYSTEM_PROMPT = [
  "You are a smart inbox assistant. Given a single email thread, answer briefly:",
  "1. whyMatters: Why is this thread important for this person? (1 sentence, specific)",
  "2. nextAction: The single best next action (be specific — 'Reply confirming X' not 'Reply to email')",
  "3. isFollowUpNeeded: true if the user should have followed up already or needs to soon",
  "4. followUpSuggestion: if isFollowUpNeeded, what to say (short)",
  "Be concise. Respond with valid JSON only: { whyMatters, nextAction, isFollowUpNeeded, followUpSuggestion? }",
].join("\n");

function buildThreadContextPrompt(opts: {
  subject: string;
  from: string;
  messages: Array<{ from?: string; body: string }>;
  relatedCount: number;
  relatedEventCount: number;
  userEmail?: string;
}): string {
  const lines = [
    `Subject: ${opts.subject}`,
    `From: ${opts.from}`,
    `Total messages in thread: ${opts.messages.length}`,
  ];

  for (const [i, msg] of opts.messages.slice(-3).entries()) {
    lines.push(`Message ${i + 1} (from: ${msg.from ?? "unknown"}):`);
    lines.push(msg.body.slice(0, 600));
  }

  if (opts.relatedCount > 0) {
    lines.push(``, `${opts.relatedCount} other related email threads found.`);
  }
  if (opts.relatedEventCount > 0) {
    lines.push(`${opts.relatedEventCount} related calendar events found.`);
  }

  return lines.join("\n");
}

export async function getThreadContext(input: {
  tenantId: string;
  threadId: string;
  userEmail?: string;
}): Promise<ThreadContextResult> {
  const inbox = getInboxService();
  const calendar = getCalendarService();

  const thread = await inbox.getThread(input.tenantId, input.threadId, {
    userEmail: input.userEmail,
  });

  if (!thread) {
    return {
      threadId: input.threadId,
      whyMatters: "Thread not found.",
      nextAction: "Check your inbox.",
      isFollowUpNeeded: false,
      relatedThreads: [],
      relatedEvents: [],
      senderInfo: null,
    };
  }

  const subject = thread.subject?.trim() || "";
  const fromEmail = extractEmailAddress(thread.from) ?? thread.from ?? "";
  const senderName = thread.fromName?.trim();

  // Corsair: search related threads by subject keywords and sender
  const subjectKeyword = subject.replace(/^(re:|fwd?:)\s*/i, "").trim().slice(0, 60);
  const relatedQuery = subjectKeyword
    ? `subject:"${subjectKeyword.replace(/"/g, "")}" -id:${input.threadId}`
    : fromEmail
      ? `from:${fromEmail} -id:${input.threadId} newer_than:30d`
      : null;

  const relatedThreadsPromise = relatedQuery
    ? inbox
        .listThreads(input.tenantId, { maxResults: 5, query: relatedQuery })
        .catch(() => ({ threads: [] }))
    : Promise.resolve({ threads: [] });

  // Corsair: related calendar events around the thread date
  const threadDate = thread.date ? new Date(thread.date) : new Date();
  const eventWindowStart = new Date(threadDate.getTime() - 3 * 86_400_000).toISOString();
  const eventWindowEnd = new Date(threadDate.getTime() + 7 * 86_400_000).toISOString();

  const calStatus = await calendar.getConnectionStatus(input.tenantId);
  const relatedEventsPromise =
    calStatus.googlecalendar === "connected"
      ? calendar
          .listEvents(input.tenantId, {
            timeMin: eventWindowStart,
            timeMax: eventWindowEnd,
            maxResults: 5,
          })
          .catch(() => ({ events: [] }))
      : Promise.resolve({ events: [] });

  const [relatedThreadsResult, relatedEventsResult] = await Promise.all([
    relatedThreadsPromise,
    relatedEventsPromise,
  ]);

  const relatedThreads = relatedThreadsResult.threads
    .filter((t) => t.id !== input.threadId)
    .slice(0, 4)
    .map((t) => ({
      id: t.id,
      subject: t.subject?.trim() || "No subject",
      from: t.fromName?.trim() || t.from?.trim() || "Unknown",
      date: t.date,
    }));

  const relatedEvents = relatedEventsResult.events
    .filter((e) => e.status !== "cancelled")
    .slice(0, 3)
    .map((e) => ({ id: e.id, summary: e.summary?.trim() || "Untitled", start: e.start }));

  // Detect if user needs to follow up (last message was from user, no reply, > 2 days)
  const messages = thread.messages ?? [];
  const lastMsg = messages[messages.length - 1];
  const lastMsgFrom = extractEmailAddress(lastMsg?.from) ?? "";
  const userEmail = normalizeEmail(input.userEmail) ?? "";
  const lastWasUser = userEmail && lastMsgFrom.includes(userEmail);
  const daysSinceLast = daysSince(lastMsg?.date ?? thread.date);
  const followUpNeeded = Boolean(lastWasUser && daysSinceLast != null && daysSinceLast >= 2);

  // Sender last interaction
  const senderInfo = fromEmail
    ? {
        email: fromEmail,
        name: senderName,
        lastInteractionDaysAgo: daysSince(thread.date),
      }
    : null;

  // OpenAI — why this matters + next action
  if (!isOpenAiConfigured()) {
    return {
      threadId: input.threadId,
      whyMatters: subject ? `Unread thread: "${subject}"` : "Unread email from your inbox.",
      nextAction: followUpNeeded ? "Send a follow-up" : "Read and reply",
      isFollowUpNeeded: followUpNeeded,
      followUpSuggestion: followUpNeeded
        ? `Hi, just following up on "${subject}" — any update?`
        : undefined,
      relatedThreads,
      relatedEvents,
      senderInfo,
    };
  }

  const prompt = buildThreadContextPrompt({
    subject,
    from: senderName ?? fromEmail,
    messages: (thread.messages ?? []).map((m) => ({ from: m.from, body: m.body })),
    relatedCount: relatedThreads.length,
    relatedEventCount: relatedEvents.length,
    userEmail: input.userEmail,
  });

  type AIContextResult = {
    whyMatters?: string;
    nextAction?: string;
    isFollowUpNeeded?: boolean;
    followUpSuggestion?: string;
  };

  let ai: AIContextResult = {};
  try {
    const raw = await createChatCompletion(
      [
        { role: "system", content: CONTEXT_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      { jsonObject: true, temperature: 0.3 },
    );
    ai = JSON.parse(raw) as AIContextResult;
  } catch {
    // Fall through to defaults
  }

  return {
    threadId: input.threadId,
    whyMatters: (typeof ai.whyMatters === "string" && ai.whyMatters.trim()) || `Unread: "${subject}"`,
    nextAction:
      (typeof ai.nextAction === "string" && ai.nextAction.trim()) ||
      (followUpNeeded ? "Send a follow-up" : "Read and reply"),
    isFollowUpNeeded: Boolean(ai.isFollowUpNeeded ?? followUpNeeded),
    followUpSuggestion:
      typeof ai.followUpSuggestion === "string" ? ai.followUpSuggestion.trim() : undefined,
    relatedThreads,
    relatedEvents,
    senderInfo,
  };
}
