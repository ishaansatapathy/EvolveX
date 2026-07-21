export type ZonedDayRange = {
  dateKey: string;
  timeMin: string;
  timeMax: string;
};

/** Wall-clock date in IANA timezone (YYYY-MM-DD). */
export function zonedDateKey(timeZone: string, ref = new Date()): string {
  return ref.toLocaleDateString("en-CA", { timeZone });
}

/**
 * Offset between UTC instant and its representation in `timeZone` (ms).
 * Positive when the timezone is ahead of UTC.
 */
export function getTimeZoneOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );

  return asUtc - date.getTime();
}

/** Convert local wall time in `timeZone` to a UTC ISO string. */
export function zonedWallTimeToIso(dateKey: string, time: string, timeZone: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute, second = "0"] = time.split(":");
  let guess = Date.UTC(year!, month! - 1, day!, Number(hour), Number(minute), Number(second));

  for (let i = 0; i < 4; i++) {
    const offset = getTimeZoneOffsetMs(timeZone, new Date(guess));
    const next = Date.UTC(year!, month! - 1, day!, Number(hour), Number(minute), Number(second)) - offset;
    if (next === guess) break;
    guess = next;
  }

  return new Date(guess).toISOString();
}

export function zonedDayRange(timeZone: string, ref = new Date()): ZonedDayRange {
  const dateKey = zonedDateKey(timeZone, ref);
  return {
    dateKey,
    timeMin: zonedWallTimeToIso(dateKey, "00:00:00", timeZone),
    timeMax: zonedWallTimeToIso(dateKey, "23:59:59", timeZone),
  };
}

export type BusySlot = { start: string; end: string };

export type FocusWindow = {
  startIso: string;
  endIso: string;
  durationMinutes: number;
};

/**
 * Find the longest focus window(s) between busy blocks on a given day.
 * `workStart` / `workEnd` are HH:mm in the user's timezone.
 */
export function findFocusWindows(opts: {
  dayStartIso: string;
  dayEndIso: string;
  busySlots: BusySlot[];
  minMinutes?: number;
  workStart?: string;
  workEnd?: string;
}): FocusWindow[] {
  const minMs = (opts.minMinutes ?? 90) * 60_000;
  const dayStart = Date.parse(opts.dayStartIso);
  const dayEnd = Date.parse(opts.dayEndIso);
  if (Number.isNaN(dayStart) || Number.isNaN(dayEnd) || dayEnd <= dayStart) return [];

  const workStartMs = opts.workStart
    ? dayStart + parseWallClockOffset(opts.workStart)
    : dayStart;
  const workEndMs = opts.workEnd
    ? dayStart + parseWallClockOffset(opts.workEnd)
    : dayEnd;

  const merged = mergeBusySlots(
    opts.busySlots
      .map((slot) => ({
        start: Math.max(dayStart, Date.parse(slot.start)),
        end: Math.min(dayEnd, Date.parse(slot.end)),
      }))
      .filter((slot) => !Number.isNaN(slot.start) && !Number.isNaN(slot.end) && slot.end > slot.start),
  );

  const windows: FocusWindow[] = [];
  let cursor = Math.max(dayStart, workStartMs);

  for (const busy of merged) {
    if (busy.start > cursor) {
      pushWindow(windows, cursor, Math.min(busy.start, workEndMs), minMs);
    }
    cursor = Math.max(cursor, busy.end);
  }

  if (cursor < workEndMs) {
    pushWindow(windows, cursor, workEndMs, minMs);
  }

  return windows.sort((a, b) => b.durationMinutes - a.durationMinutes);
}

function parseWallClockOffset(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h! * 60 + m!) * 60_000;
}

function mergeBusySlots(slots: Array<{ start: number; end: number }>) {
  if (slots.length === 0) return [];
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

function pushWindow(out: FocusWindow[], start: number, end: number, minMs: number) {
  const durationMs = end - start;
  if (durationMs < minMs) return;
  out.push({
    startIso: new Date(start).toISOString(),
    endIso: new Date(end).toISOString(),
    durationMinutes: Math.round(durationMs / 60_000),
  });
}

export function formatLocalTimeRange(
  startIso: string,
  endIso: string,
  timeZone: string,
): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";

  const fmt = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });

  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

export function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
}

export function extractEmailAddress(value?: string): string | null {
  if (!value) return null;
  const match = value.match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim().toLowerCase();
  if (value.includes("@")) return value.trim().toLowerCase();
  return null;
}

export function normalizeEmail(value?: string | null): string | null {
  if (!value) return null;
  return value.trim().toLowerCase();
}

export function zonedHour(timeZone: string, ref = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).format(ref),
  );
}

/** Time-aware greeting — not always "Good morning". */
export function timeOfDayGreeting(name: string, timeZone: string, ref = new Date()): string {
  const hour = zonedHour(timeZone, ref);
  let lead = "Hello";
  if (hour >= 5 && hour < 12) lead = "Good morning";
  else if (hour >= 12 && hour < 17) lead = "Good afternoon";
  else if (hour >= 17 && hour < 22) lead = "Good evening";
  return `${lead}, ${name}`;
}
