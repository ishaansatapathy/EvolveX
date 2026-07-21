import { describe, expect, it } from "vitest";

import { resolveCalendarEventId } from "./scope";

describe("resolveCalendarEventId", () => {
  it("uses instance id by default", () => {
    expect(resolveCalendarEventId("inst-1", "series-master")).toBe("inst-1");
  });

  it("uses master id for series scope", () => {
    expect(resolveCalendarEventId("inst-1", "series-master", "series")).toBe("series-master");
  });

  it("falls back to instance when master id missing", () => {
    expect(resolveCalendarEventId("inst-1", undefined, "series")).toBe("inst-1");
  });
});
