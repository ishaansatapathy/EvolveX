import { describe, expect, it } from "vitest";

import { findFocusWindows, timeOfDayGreeting, zonedDayRange } from "./daily-brief-time";

describe("daily-brief-time", () => {
  it("computes a day range for a timezone", () => {
    const range = zonedDayRange("UTC", new Date("2026-06-14T12:00:00.000Z"));
    expect(range.dateKey).toBe("2026-06-14");
    expect(range.timeMin).toBe("2026-06-14T00:00:00.000Z");
    expect(range.timeMax).toBe("2026-06-14T23:59:59.000Z");
  });

  it("finds a focus window between busy blocks", () => {
    const windows = findFocusWindows({
      dayStartIso: "2026-06-14T09:00:00.000Z",
      dayEndIso: "2026-06-14T18:00:00.000Z",
      busySlots: [
        { start: "2026-06-14T09:00:00.000Z", end: "2026-06-14T11:00:00.000Z" },
        { start: "2026-06-14T15:00:00.000Z", end: "2026-06-14T16:00:00.000Z" },
      ],
      minMinutes: 60,
    });

    expect(windows.length).toBeGreaterThan(0);
    const best = windows[0]!;
    expect(best.durationMinutes).toBeGreaterThanOrEqual(60);
  });

  it("returns empty windows when the day is fully booked", () => {
    const windows = findFocusWindows({
      dayStartIso: "2026-06-14T09:00:00.000Z",
      dayEndIso: "2026-06-14T18:00:00.000Z",
      busySlots: [
        { start: "2026-06-14T08:00:00.000Z", end: "2026-06-14T18:00:00.000Z" },
      ],
      minMinutes: 90,
    });

    expect(windows).toEqual([]);
  });

  it("uses afternoon greeting outside morning hours", () => {
    const greeting = timeOfDayGreeting("Ishaan", "UTC", new Date("2026-06-14T14:00:00.000Z"));
    expect(greeting).toBe("Good afternoon, Ishaan");
  });
});
