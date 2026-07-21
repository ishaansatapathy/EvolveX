/**
 * Meeting Prep — for a calendar event, pull:
 *   1. Event details via Corsair Calendar
 *   2. Related emails via Corsair Gmail search (attendees + subject)
 *   3. OpenAI: agenda, talking points, risks, what to prepare
 */
import { getCalendarService } from "../calendar";
import { getInboxService } from "../inbox";
import { createChatCompletion, isOpenAiConfigured } from "./openai";

export type MeetingPrepResult = {
  eventId: string;
  summary: string;
  start?: string;
  attendeeNames: string[];
  agenda: string;
  talkingPoints: string[];
  risks: string[];
  relatedEmails: Array<{ id: string; subject: string; from: string; snippet: string }>;
  prepNote: string;
};

const MEETING_PREP_SYSTEM = [
  "You prepare a professional for an upcoming meeting.",
  "Given meeting details and any related emails, produce:",
  "- agenda: suggested agenda (2-3 lines)",
  "- talkingPoints: 2-4 specific talking points based on the context",
  "- risks: 1-2 risks or open questions (e.g. 'No agenda set', 'Invoice discussed but unresolved')",
  "- prepNote: 1 clear sentence — what the person should do BEFORE the meeting",
  "Be specific. Reference actual email subjects or context if available.",
  "Respond with valid JSON only: { agenda, talkingPoints, risks, prepNote }",
].join("\n");

function buildMeetingPrompt(opts: {
  summary: string;
  description?: string;
  start?: string;
  attendees: string[];
  emails: Array<{ subject: string; from: string; snippet: string; attachments?: string[] }>;
}): string {
  const lines = [
    `Meeting: ${opts.summary}`,
    `Time: ${opts.start ?? "Today"}`,
  ];

  if (opts.attendees.length > 0) {
    lines.push(`Attendees: ${opts.attendees.join(", ")}`);
  }

  if (opts.description?.trim()) {
    lines.push(``, `Calendar description:`, opts.description.trim().slice(0, 400));
  }

  if (opts.emails.length > 0) {
    lines.push(``, `Related emails found:`);
    for (const email of opts.emails) {
      lines.push(`- Subject: ${email.subject} | From: ${email.from}`);
      if (email.snippet) lines.push(`  ${email.snippet.slice(0, 200)}`);
      if (email.attachments && email.attachments.length > 0) {
        lines.push(`  Attachments: ${email.attachments.join(", ")}`);
      }
    }
  } else {
    lines.push(``, `No related emails found.`);
  }

  return lines.join("\n");
}

export async function getMeetingPrep(input: {
  tenantId: string;
  eventId: string;
  timeZone?: string;
}): Promise<MeetingPrepResult> {
  const calendar = getCalendarService();
  const inbox = getInboxService();

  // Fetch the specific event directly via Corsair Calendar (getEvent is O(1))
  const event = await calendar.getEvent(input.tenantId, input.eventId);

  if (!event) {
    return {
      eventId: input.eventId,
      summary: "Meeting not found",
      attendeeNames: [],
      agenda: "",
      talkingPoints: [],
      risks: ["Meeting could not be loaded from calendar"],
      relatedEmails: [],
      prepNote: "Check your calendar directly.",
    };
  }

  const attendees = (event.attendees ?? [])
    .map((a) => a.displayName?.trim() || a.email?.split("@")[0] || "")
    .filter(Boolean);

  const attendeeEmails = (event.attendees ?? [])
    .map((a) => a.email?.trim())
    .filter(Boolean) as string[];

  // Corsair Gmail search — related emails by subject or attendee
  const summary = event.summary?.trim() || "";
  const searchQueries: string[] = [];

  if (summary.length > 3) {
    searchQueries.push(
      `newer_than:30d subject:"${summary.replace(/"/g, "").slice(0, 50)}"`,
    );
  }
  for (const email of attendeeEmails.slice(0, 2)) {
    searchQueries.push(`newer_than:14d from:${email}`);
  }

  const gmailStatus = await inbox.getConnectionStatus(input.tenantId);
  const relatedEmailsRaw: Array<{ id: string; subject: string; from: string; snippet: string; attachments?: string[] }> = [];

  if (gmailStatus.gmail === "connected") {
    const seen = new Set<string>();
    for (const query of searchQueries) {
      try {
        const result = await inbox.listThreads(input.tenantId, { maxResults: 4, query });
        for (const t of result.threads) {
          if (!seen.has(t.id)) {
            seen.add(t.id);
            // Collect attachment names from messages if available
            const attachmentNames = (t.messages ?? [])
              .flatMap((m) => m.attachments ?? [])
              .map((a) => a.filename)
              .filter(Boolean);
            relatedEmailsRaw.push({
              id: t.id,
              subject: t.subject?.trim() || "No subject",
              from: t.fromName?.trim() || t.from?.trim() || "Unknown",
              snippet: t.snippet?.trim() || "",
              attachments: attachmentNames.length > 0 ? attachmentNames : undefined,
            });
          }
        }
      } catch {
        // skip failed searches
      }
      if (relatedEmailsRaw.length >= 6) break;
    }
  }

  const relatedEmails = relatedEmailsRaw.slice(0, 6);

  // OpenAI prep
  const defaultRisks: string[] = [];
  if (!event.description?.trim() || event.description.trim().length < 20) {
    defaultRisks.push("No agenda in the calendar invite");
  }
  if (attendees.length === 0) {
    defaultRisks.push("No attendees listed");
  }

  if (!isOpenAiConfigured()) {
    return {
      eventId: input.eventId,
      summary,
      start: event.start,
      attendeeNames: attendees,
      agenda: event.description?.trim() || "No agenda provided.",
      talkingPoints: attendees.length > 0 ? [`Discuss latest updates with ${attendees[0]}`] : [],
      risks: defaultRisks,
      relatedEmails,
      prepNote:
        relatedEmails.length > 0
          ? `Review "${relatedEmails[0]!.subject}" before the meeting.`
          : "Review the calendar invite and prepare notes.",
    };
  }

  const prompt = buildMeetingPrompt({
    summary,
    description: event.description,
    start: event.start,
    attendees,
    emails: relatedEmails,
  });

  type AIPrep = {
    agenda?: string;
    talkingPoints?: string[];
    risks?: string[];
    prepNote?: string;
  };

  let ai: AIPrep = {};
  try {
    const raw = await createChatCompletion(
      [
        { role: "system", content: MEETING_PREP_SYSTEM },
        { role: "user", content: prompt },
      ],
      { jsonObject: true, temperature: 0.35 },
    );
    ai = JSON.parse(raw) as AIPrep;
  } catch {
    // fall through
  }

  return {
    eventId: input.eventId,
    summary,
    start: event.start,
    attendeeNames: attendees,
    agenda: (typeof ai.agenda === "string" && ai.agenda.trim()) || event.description?.trim() || "No agenda provided.",
    talkingPoints: Array.isArray(ai.talkingPoints)
      ? ai.talkingPoints.filter((t) => typeof t === "string").slice(0, 4)
      : [],
    risks: Array.isArray(ai.risks)
      ? ai.risks.filter((r) => typeof r === "string").slice(0, 3)
      : defaultRisks,
    relatedEmails,
    prepNote:
      (typeof ai.prepNote === "string" && ai.prepNote.trim()) ||
      (relatedEmails.length > 0
        ? `Review "${relatedEmails[0]!.subject}" before the meeting.`
        : "Review the calendar invite and prepare notes."),
  };
}
