import { describe, expect, it } from "vitest";

import { computeAiConfidence } from "./ai-confidence";

describe("computeAiConfidence", () => {
  it("returns low when timeline is empty", () => {
    const result = computeAiConfidence({
      completenessPercent: 0,
      canConclude: false,
      hasLlmSummary: false,
      pinpointConfidence: null,
      timelineCount: 0,
    });

    expect(result.level).toBe("low");
  });

  it("returns high when evidence is conclusive with LLM summary", () => {
    const result = computeAiConfidence({
      completenessPercent: 82,
      canConclude: true,
      hasLlmSummary: true,
      pinpointConfidence: "medium",
      timelineCount: 4,
    });

    expect(result.level).toBe("high");
  });

  it("returns medium for partial LLM coverage", () => {
    const result = computeAiConfidence({
      completenessPercent: 50,
      canConclude: false,
      hasLlmSummary: true,
      pinpointConfidence: null,
      timelineCount: 3,
    });

    expect(result.level).toBe("medium");
  });
});
