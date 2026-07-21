export type CalendarEditScope = "instance" | "series" | "following";

/** Resolve Google Calendar event id for instance vs whole-series edits. */
export function resolveCalendarEventId(
  eventId: string,
  recurringEventId?: string,
  editScope: CalendarEditScope = "instance",
): string {
  if (editScope === "series" && recurringEventId?.trim()) {
    return recurringEventId.trim();
  }
  return eventId;
}
