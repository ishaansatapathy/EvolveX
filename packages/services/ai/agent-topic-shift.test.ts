import { describe, expect, it } from "vitest";

import { detectTopicShift } from "./agent-topic-shift";

describe("detectTopicShift", () => {
  it("does nothing when no focus is set", () => {
    expect(detectTopicShift("What's on my calendar tomorrow?", undefined)).toEqual({
      shouldClearFocus: false,
    });
  });

  it("keeps focus when user uses deictic reference", () => {
    expect(
      detectTopicShift("Summarize this for me", { threadId: "t-1" }, [
        { at: "1", tool: "get_thread", summary: "Read thread Cohort launch" },
      ]),
    ).toEqual({ shouldClearFocus: false });
  });

  it("clears thread focus on explicit calendar intent", () => {
    expect(detectTopicShift("What meetings do I have tomorrow?", { threadId: "t-1" })).toEqual({
      shouldClearFocus: true,
      reason: "calendar_intent",
    });
  });

  it("clears event focus on explicit inbox intent", () => {
    expect(detectTopicShift("Search my inbox for payroll emails", { eventId: "e-1" })).toEqual({
      shouldClearFocus: true,
      reason: "inbox_intent",
    });
  });

  it("clears focus on fresh unrelated search", () => {
    expect(
      detectTopicShift("Search my inbox for investor update about Series B funding", { threadId: "t-old" }, [
        { at: "1", tool: "summarize_thread", summary: "Summarized Cohort launch" },
      ]),
    ).toEqual({
      shouldClearFocus: true,
      reason: "new_search",
    });
  });

  it("keeps focus when search overlaps recent tool memory", () => {
    expect(
      detectTopicShift("Search for cohort launch details", { threadId: "t-1" }, [
        { at: "1", tool: "summarize_thread", summary: "Summarized cohort launch planning" },
      ]),
    ).toEqual({ shouldClearFocus: false });
  });
});
