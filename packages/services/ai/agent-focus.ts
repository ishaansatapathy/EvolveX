import { getCalendarService } from "../calendar";
import { getInboxService } from "../inbox";
import { summarizeThread } from "./summarize-thread";

export type AgentFocus = {
  threadId?: string;
  eventId?: string;
};

export async function buildFocusSystemAppendix(
  tenantId: string,
  focus: AgentFocus | undefined,
  userEmail?: string,
): Promise<string> {
  if (!focus?.threadId?.trim() && !focus?.eventId?.trim()) return "";

  const lines = [
    "",
    "═══ CURRENT USER FOCUS (highest priority — overrides older chat topics) ═══",
  ];

  if (focus.threadId?.trim()) {
    const threadId = focus.threadId.trim();
    try {
      const summary = await summarizeThread({ tenantId, threadId, userEmail });
      lines.push(
        "Type: EMAIL THREAD (Gmail)",
        `threadId: ${threadId}`,
        `subject: ${summary.subject}`,
        `summary: ${summary.summary}`,
        summary.actionItems.length
          ? `action items: ${summary.actionItems.map((a) => a.action).join("; ")}`
          : "",
        `next step: ${summary.nextStep}`,
        "",
        'When the user says "this", "this one", "summarize", "tell me about this", or "this event" in an email/inbox context, they mean THIS EMAIL THREAD — not Google Calendar.',
        `Use summarize_thread or get_thread with threadId "${threadId}".`,
        "Only use calendar tools if the user explicitly asks about calendar, meetings, schedule, or appointment times.",
      );
    } catch {
      const inbox = getInboxService();
      const thread = await inbox.getThread(tenantId, threadId, { userEmail });
      lines.push(
        "Type: EMAIL THREAD (Gmail)",
        `threadId: ${threadId}`,
        `subject: ${thread?.subject?.trim() || "(unknown)"}`,
        "",
        'User references like "this email" or "summarize this" mean this threadId. Use get_thread or summarize_thread.',
      );
    }
  }

  if (focus.eventId?.trim()) {
    const eventId = focus.eventId.trim();
    const calendar = getCalendarService();
    const event = await calendar.getEvent(tenantId, eventId);
    if (event) {
      lines.push(
        "",
        "Type: CALENDAR EVENT",
        `eventId: ${eventId}`,
        `title: ${event.summary}`,
        event.start ? `starts: ${event.start}` : "",
        event.description ? `description: ${event.description.slice(0, 400)}` : "",
        "",
        'When the user says "this meeting" or "this event" with calendar context, use get_calendar_event with this eventId.',
      );
    } else {
      lines.push("", `Type: CALENDAR EVENT`, `eventId: ${eventId}`, "Use get_calendar_event with this id.");
    }
  }

  return lines.filter(Boolean).join("\n");
}
