/**
 * find_meeting_slots — AI-powered scheduling assistant.
 *
 * Given a duration and a preferred date range, queries Corsair Calendar
 * free/busy and returns up to 5 concrete time slot suggestions formatted for
 * humans. Works for single user or when an attendee email is provided.
 */

import { getCalendarService } from "../calendar";
import { createChatCompletion, isOpenAiConfigured } from "./openai";

export type MeetingSlot = {
  startIso: string;
  endIso: string;
  label: string; // human-readable e.g. "Tuesday 24 Jun, 3:00–4:00 PM"
};

export type FindMeetingSlotsResult = {
  slots: MeetingSlot[];
  note?: string;
  calendarConnected: boolean;
};

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function roundUpToNextHour(iso: string): Date {
  const d = new Date(iso);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

function formatSlotLabel(startIso: string, endIso: string, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  const fmtTime = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${fmt.format(new Date(startIso))} – ${fmtTime.format(new Date(endIso))}`;
}

function findFreeSlots(
  busySlots: Array<{ start: string; end: string }>,
  rangeStart: Date,
  rangeEnd: Date,
  durationMs: number,
  workdayStartHour: number,
  workdayEndHour: number,
  timeZone: string,
  maxSlots: number,
): MeetingSlot[] {
  const slots: MeetingSlot[] = [];
  const step = 30 * 60 * 1000; // 30-min increments

  let cursor = roundUpToNextHour(rangeStart.toISOString());

  while (cursor < rangeEnd && slots.length < maxSlots) {
    // Only suggest during working hours
    const localHour = parseInt(
      new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(cursor),
      10,
    );

    if (localHour < workdayStartHour || localHour + Math.ceil(durationMs / 3_600_000) > workdayEndHour) {
      // Jump to next workday start
      const tomorrow = new Date(cursor);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(workdayStartHour, 0, 0, 0);
      cursor = tomorrow;
      continue;
    }

    // Skip weekends
    const dayOfWeek = cursor.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      const nextMon = new Date(cursor);
      nextMon.setDate(nextMon.getDate() + (dayOfWeek === 0 ? 1 : 2));
      nextMon.setHours(workdayStartHour, 0, 0, 0);
      cursor = nextMon;
      continue;
    }

    const slotEnd = new Date(cursor.getTime() + durationMs);

    // Check conflicts
    const conflict = busySlots.some((b) => {
      const bStart = new Date(b.start).getTime();
      const bEnd = new Date(b.end).getTime();
      return cursor.getTime() < bEnd && slotEnd.getTime() > bStart;
    });

    if (!conflict) {
      slots.push({
        startIso: cursor.toISOString(),
        endIso: slotEnd.toISOString(),
        label: formatSlotLabel(cursor.toISOString(), slotEnd.toISOString(), timeZone),
      });
      // Jump past this slot to avoid overlapping suggestions
      cursor = slotEnd;
    } else {
      cursor = new Date(cursor.getTime() + step);
    }
  }

  return slots;
}

export async function findMeetingSlots(input: {
  tenantId: string;
  durationMinutes: number;
  preferredStartDate?: string; // ISO date or datetime, defaults to today
  preferredEndDate?: string;   // ISO date or datetime, defaults to +7 days
  timeZone?: string;
  attendeeEmail?: string;      // If provided, include in note (can't check external calendars)
  context?: string;            // e.g. "1:1 with Rahul", "planning session"
}): Promise<FindMeetingSlotsResult> {
  const calendar = getCalendarService();
  const timeZone = input.timeZone?.trim() || "UTC";
  const durationMs = Math.max(15, Math.min(480, input.durationMinutes)) * 60 * 1000;

  const now = new Date();
  const rangeStart = input.preferredStartDate
    ? new Date(input.preferredStartDate)
    : now;
  const rangeEnd = input.preferredEndDate
    ? new Date(input.preferredEndDate)
    : new Date(addDays(rangeStart.toISOString(), 7));

  const status = await calendar.getConnectionStatus(input.tenantId);
  const calendarConnected = status.googlecalendar === "connected";

  if (!calendarConnected) {
    return {
      slots: [],
      note: "Google Calendar is not connected. Connect it in Settings to see available slots.",
      calendarConnected: false,
    };
  }

  const freeBusyResult = await calendar.checkFreeBusy(input.tenantId, {
    startDateTime: rangeStart.toISOString(),
    endDateTime: rangeEnd.toISOString(),
    timeZone,
  });

  const busySlots = (freeBusyResult.conflicts ?? []).map((c) => ({
    start: c.start ?? rangeStart.toISOString(),
    end: c.end ?? rangeStart.toISOString(),
  }));

  const rawSlots = findFreeSlots(
    busySlots,
    rangeStart,
    rangeEnd,
    durationMs,
    9,  // workday start hour
    18, // workday end hour
    timeZone,
    8,  // find up to 8 candidates
  );

  // Use OpenAI to pick the best 3–5 slots if available
  if (isOpenAiConfigured() && rawSlots.length > 3 && input.context) {
    try {
      const prompt = [
        `Context: ${input.context}`,
        `Duration: ${input.durationMinutes} minutes`,
        `Timezone: ${timeZone}`,
        `Available slots (all free in calendar):`,
        rawSlots.map((s, i) => `${i + 1}. ${s.label}`).join("\n"),
        "",
        "Return a JSON array of the 3–5 best slot indices (0-based) for this context. Prefer mid-morning or mid-afternoon. Avoid back-to-back patterns. Return only the array, e.g. [0,2,4]",
      ].join("\n");

      const raw = await createChatCompletion(
        [{ role: "user", content: prompt }],
        { jsonObject: false, temperature: 0.2 },
      );
      const indices: number[] = JSON.parse(raw.replace(/[^[\]0-9,]/g, ""));
      const picked = indices
        .filter((i) => i >= 0 && i < rawSlots.length)
        .slice(0, 5)
        .map((i) => rawSlots[i]!);
      if (picked.length >= 2) {
        return {
          slots: picked,
          note: input.attendeeEmail
            ? `Slots based on your calendar. You'll need to verify ${input.attendeeEmail}'s availability separately.`
            : undefined,
          calendarConnected: true,
        };
      }
    } catch {
      // fall through to raw slots
    }
  }

  return {
    slots: rawSlots.slice(0, 5),
    note: input.attendeeEmail
      ? `Slots based on your calendar only. Verify ${input.attendeeEmail}'s availability separately.`
      : rawSlots.length === 0
        ? `No free ${input.durationMinutes}-minute slots found in the selected range. Try a wider date range.`
        : undefined,
    calendarConnected: true,
  };
}
