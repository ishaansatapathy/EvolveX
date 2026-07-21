export type CalendarConnectionState =
  | "connected"
  | "missing_credentials"
  | "not_connected"
  | "not_configured";

export type CalendarConnectionStatus = {
  googlecalendar: CalendarConnectionState;
};

export type CalendarEventAttendee = {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  organizer?: boolean;
  optional?: boolean;
};

export type CalendarEvent = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  htmlLink?: string;
  status?: string;
  /** Set by Google when this instance belongs to a recurring series. */
  recurringEventId?: string;
  isRecurring?: boolean;
  attendees?: CalendarEventAttendee[];
  hangoutLink?: string;
};

export interface CalendarService {
  isConfigured(): boolean;
  getConnectionStatus(tenantId: string): Promise<CalendarConnectionStatus>;
  /** Fetch a single event by id. Returns null if not found or disconnected. */
  getEvent(tenantId: string, eventId: string): Promise<CalendarEvent | null>;
  listEvents(
    tenantId: string,
    opts: {
      timeMin: string;
      timeMax: string;
      maxResults?: number;
      timeZone?: string;
      pageToken?: string;
      /** Free-text search across summary, description, and attendees (Google Calendar `q` param). */
      q?: string;
    },
  ): Promise<{ events: CalendarEvent[]; nextPageToken?: string }>;
  createEvent(
    tenantId: string,
    input: {
      summary: string;
      description?: string;
      location?: string;
      startDateTime: string;
      endDateTime: string;
      timeZone?: string;
      attendeeEmails?: string[];
      allDay?: boolean;
      recurrence?: string[];
    },
  ): Promise<CalendarEvent>;
  cancelEvent(tenantId: string, eventId: string): Promise<{ success: true }>;
  deleteEvent(
    tenantId: string,
    eventId: string,
    opts?: { editScope?: "instance" | "series" | "following"; recurringEventId?: string },
  ): Promise<{ success: true }>;
  updateEventTimes(
    tenantId: string,
    eventId: string,
    input: { startDateTime: string; endDateTime: string; timeZone?: string; allDay?: boolean },
    opts?: { editScope?: "instance" | "series" | "following"; recurringEventId?: string },
  ): Promise<CalendarEvent>;
  /**
   * Check for free/busy conflicts in the given time range.
   * Returns events that overlap with the proposed time slot.
   */
  checkFreeBusy(
    tenantId: string,
    input: { startDateTime: string; endDateTime: string; timeZone?: string },
  ): Promise<{ conflicts: CalendarEvent[]; unavailable?: boolean }>;
  /**
   * Respond to a calendar event invitation (accept / decline / tentative).
   * Updates the authenticated user's attendee status on the event.
   */
  respondToEvent(
    tenantId: string,
    eventId: string,
    response: "accepted" | "declined" | "tentative",
  ): Promise<CalendarEvent>;
  /**
   * Patch non-time metadata of a calendar event (title, description, location).
   * For time changes use updateEventTimes.
   */
  patchEventDetails(
    tenantId: string,
    eventId: string,
    patch: { summary?: string; description?: string; location?: string },
  ): Promise<CalendarEvent | null>;
  /**
   * Create a calendar event from a natural-language text string using Google Calendar's quickAdd.
   * E.g. "Lunch with Sarah tomorrow at noon" → real event.
   */
  quickAddEvent(tenantId: string, text: string): Promise<CalendarEvent>;
  /** Revoke Google Calendar OAuth credentials (disconnect). Throws on failure. */
  disconnect(tenantId: string): Promise<void>;
  /**
   * Register a Google Calendar push-notification channel.
   * Best-effort — does not throw on failure.
   */
  registerWebhook(tenantId: string, webhookUrl: string): Promise<void>;

  /** Search synced calendar events via googlecalendar.db.events.search. */
  searchEventsDb(
    tenantId: string,
    opts?: { query?: string; limit?: number; offset?: number },
  ): Promise<{ events: CalendarEvent[] }>;

  /** Search synced calendars via googlecalendar.db.calendars.search. */
  searchCalendarsDb(
    tenantId: string,
    opts?: { query?: string; limit?: number; offset?: number },
  ): Promise<{ calendars: Array<{ id: string; summary?: string; timeZone?: string }> }>;
}

let calendarService: CalendarService | null = null;

export function registerCalendarService(service: CalendarService) {
  calendarService = service;
}

export function getCalendarService(): CalendarService {
  if (!calendarService) {
    throw new Error("Calendar service is not registered");
  }
  return calendarService;
}

export { resolveCalendarEventId, type CalendarEditScope } from "./scope";
