/**
 * Missed Follow-up Detector
 *
 * Cross-references Corsair Calendar (past meetings) with Corsair Gmail (sent mail)
 * to find meetings where the user never sent a follow-up email.
 *
 * Full loop: Calendar → Gmail search → AI draft suggestion → agentPrompt for 1-click queue
 */
import { getCalendarService } from "../calendar";
import { getInboxService } from "../inbox";
import { createChatCompletion, isOpenAiConfigured } from "./openai";
import { daysSince, extractEmailAddress, normalizeEmail } from "./daily-brief-time";

export type MissedFollowUp = {
  eventId: string;
  eventSummary: string;
  eventDate: string;
  attendeeNames: string[];
  attendeeEmails: string[];
  daysAgo: number;
  agentPrompt: string;
  suggestedSubject: string;
};

function toGmailDate(iso: string): string {
  // Gmail `after:` / `before:` format: YYYY/MM/DD
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function buildFollowUpAgentPrompt(opts: {
  summary: string;
  attendeeNames: string[];
  attendeeEmails: string[];
  eventDate: string;
}): string {
  const names = opts.attendeeNames.length > 0 ? opts.attendeeNames.join(", ") : opts.attendeeEmails.join(", ");
  const date = new Date(opts.eventDate).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return `Draft a follow-up email to ${names} regarding our meeting "${opts.summary}" on ${date}. Recap the key points discussed, list any action items or next steps, and end with a call to action. Keep it professional and concise. Queue it as a draft for my review.`;
}

function buildFollowUpSuggestedSubject(summary: string): string {
  return `Follow-up: ${summary}`;
}

type AIFollowUpSuggestion = {
  subject?: string;
  agentPrompt?: string;
};

async function enrichWithAI(opts: {
  summary: string;
  attendeeNames: string[];
  daysAgo: number;
}): Promise<AIFollowUpSuggestion> {
  if (!isOpenAiConfigured()) return {};

  const prompt = `Meeting: "${opts.summary}"
Attendees: ${opts.attendeeNames.join(", ") || "unknown"}
Days ago: ${opts.daysAgo}

Generate a 1-line agent prompt that will draft a professional follow-up email, and a subject line.
Respond with JSON only: { "subject": "...", "agentPrompt": "..." }`;

  try {
    const raw = await createChatCompletion(
      [
        {
          role: "system",
          content:
            "You write concise follow-up email prompts for a busy professional. JSON only.",
        },
        { role: "user", content: prompt },
      ],
      { jsonObject: true, temperature: 0.3 },
    );
    return JSON.parse(raw) as AIFollowUpSuggestion;
  } catch {
    return {};
  }
}

export async function getMissedFollowUps(input: {
  tenantId: string;
  userEmail?: string;
  timeZone?: string;
}): Promise<MissedFollowUp[]> {
  const calendar = getCalendarService();
  const inbox = getInboxService();

  const [gmailStatus, calStatus] = await Promise.all([
    inbox.getConnectionStatus(input.tenantId),
    calendar.getConnectionStatus(input.tenantId),
  ]);

  if (gmailStatus.gmail !== "connected" || calStatus.googlecalendar !== "connected") {
    return [];
  }

  // Corsair Calendar: past 7 days meetings (not today)
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString();

  const eventsResult = await calendar.listEvents(input.tenantId, {
    timeMin: sevenDaysAgo,
    timeMax: yesterday,
    maxResults: 30,
    timeZone: input.timeZone,
  });

  // Filter: only meetings with external attendees, not all-day, not cancelled
  const userEmail = normalizeEmail(input.userEmail);
  const meetings = eventsResult.events.filter((e) => {
    if (e.status === "cancelled") return false;
    if (e.allDay) return false;
    if (!e.attendees || e.attendees.length < 2) return false;
    // Skip if user declined
    const userAttendee = e.attendees.find(
      (a) => normalizeEmail(a.email) === userEmail,
    );
    if (userAttendee?.responseStatus === "declined") return false;
    return true;
  });

  if (meetings.length === 0) return [];

  const results: MissedFollowUp[] = [];

  // Check each meeting (limit to 5 to avoid too many API calls)
  for (const event of meetings.slice(0, 5)) {
    const attendeeEmails = (event.attendees ?? [])
      .map((a) => extractEmailAddress(a.email ?? "") ?? a.email ?? "")
      .filter((e) => e && normalizeEmail(e) !== userEmail)
      .slice(0, 3);

    if (attendeeEmails.length === 0) continue;

    const eventEndIso = event.end ?? event.start;
    const gmailDateStr = toGmailDate(eventEndIso ?? sevenDaysAgo);
    if (!gmailDateStr) continue;

    // Corsair Gmail: check if user sent follow-up after meeting
    const toClause = attendeeEmails.map((e) => `to:${e}`).join(" OR ");
    const searchQuery = `in:sent after:${gmailDateStr} (${toClause})`;

    let sentCount = 0;
    try {
      const sentResult = await inbox.listThreads(input.tenantId, {
        maxResults: 3,
        query: searchQuery,
      });
      sentCount = sentResult.threads.length;
    } catch {
      continue;
    }

    // No follow-up sent → this is a miss
    if (sentCount > 0) continue;

    const daysAgo = daysSince(event.start) ?? 0;
    if (daysAgo < 1) continue; // Skip today's meetings

    const attendeeNames = (event.attendees ?? [])
      .filter((a) => normalizeEmail(a.email) !== userEmail)
      .map((a) => a.displayName?.trim() || a.email?.split("@")[0] || "")
      .filter(Boolean)
      .slice(0, 3);

    const defaultPrompt = buildFollowUpAgentPrompt({
      summary: event.summary ?? "Meeting",
      attendeeNames,
      attendeeEmails,
      eventDate: event.start ?? sevenDaysAgo,
    });

    const defaultSubject = buildFollowUpSuggestedSubject(event.summary ?? "Meeting");

    // Enrich with AI (non-blocking — use defaults on failure)
    const ai: AIFollowUpSuggestion = await enrichWithAI({
      summary: event.summary ?? "Meeting",
      attendeeNames,
      daysAgo,
    }).catch(() => ({ subject: undefined, agentPrompt: undefined }));

    results.push({
      eventId: event.id,
      eventSummary: event.summary?.trim() || "Meeting",
      eventDate: event.start ?? "",
      attendeeNames,
      attendeeEmails,
      daysAgo,
      agentPrompt: (ai.agentPrompt?.trim()) || defaultPrompt,
      suggestedSubject: (ai.subject?.trim()) || defaultSubject,
    });
  }

  return results;
}
