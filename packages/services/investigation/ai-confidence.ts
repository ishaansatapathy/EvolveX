export type AiConfidenceLevel = "high" | "medium" | "low";

export type AiConfidenceResult = {
  level: AiConfidenceLevel;
  rationale: string;
};

export function computeAiConfidence(input: {
  completenessPercent: number;
  canConclude: boolean;
  hasLlmSummary: boolean;
  pinpointConfidence: "high" | "medium" | "low" | null;
  timelineCount: number;
}): AiConfidenceResult {
  const { completenessPercent, canConclude, hasLlmSummary, pinpointConfidence, timelineCount } = input;

  if (timelineCount === 0) {
    return {
      level: "low",
      rationale: "No timeline evidence yet — confidence will rise as signals are collected.",
    };
  }

  if (canConclude && hasLlmSummary && pinpointConfidence === "high") {
    return {
      level: "high",
      rationale: "Strong evidence coverage with AI summary and high-confidence pinpoint.",
    };
  }

  if (canConclude && hasLlmSummary) {
    return {
      level: "high",
      rationale: `${completenessPercent}% evidence collected — enough to support the AI conclusion.`,
    };
  }

  if (hasLlmSummary && completenessPercent >= 45) {
    return {
      level: "medium",
      rationale: "AI summary from partial evidence — review gaps before acting.",
    };
  }

  if (completenessPercent >= 60) {
    return {
      level: "medium",
      rationale: `${completenessPercent}% evidence collected — root cause still needs verification.`,
    };
  }

  return {
    level: "low",
    rationale: "Limited evidence — collect deploy, log, and trace signals before trusting conclusions.",
  };
}
