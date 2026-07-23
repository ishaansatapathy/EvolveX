import { createChatCompletion, isOpenAiConfigured } from "../ai/openai";
import { logger } from "@repo/logger";

import type { PinpointResult } from "./pinpoint";

export type FixSuggestionResult = {
  explanation: string;
  patch: string;
  file: string;
  generatedAt: string;
  disclaimer: string;
};

/**
 * Generates a suggested fix patch from real investigation evidence.
 * Never auto-applies — caller must show preview and let user copy/apply manually.
 */
export async function suggestInvestigationFix(input: {
  investigationTitle: string;
  service: string;
  pinpoint: PinpointResult;
  timelineSummary: string;
  fileSnippet?: string | null;
}): Promise<FixSuggestionResult | null> {
  if (!isOpenAiConfigured()) {
    logger.info("Skipping fix suggestion — OPENAI_API_KEY not configured");
    return null;
  }

  const primary = input.pinpoint.primary;
  if (!primary || primary.line <= 0) {
    return null;
  }

  const systemPrompt = [
    "You are a senior engineer suggesting a minimal code fix for a production incident.",
    "Use ONLY the evidence provided. Do not invent files, lines, or root causes not supported by evidence.",
    "Respond in markdown with exactly these sections:",
    "## Explanation",
    "## Suggested patch",
    "The patch section must be a unified diff (---/+++/@@) for the single most likely file.",
    "If evidence is insufficient, say so in Explanation and provide diagnostic next steps instead of a fake patch.",
  ].join(" ");

  const userPrompt = [
    `Investigation: ${input.investigationTitle}`,
    `Service: ${input.service}`,
    `Context: ${input.timelineSummary}`,
    "",
    "Pinpoint:",
    `- File: ${primary.file}:${primary.line} (${primary.confidence} confidence, source: ${primary.source})`,
    `- Evidence: ${primary.evidence}`,
    input.pinpoint.deployCorrelation
      ? `- Deploy: ${input.pinpoint.deployCorrelation.repo}@${input.pinpoint.deployCorrelation.sha} — ${input.pinpoint.deployCorrelation.changedFiles.slice(0, 8).join(", ")}`
      : "",
    "",
    input.fileSnippet
      ? "File snippet around error line:\n```\n" + input.fileSnippet + "\n```"
      : "File snippet unavailable (set GITHUB_TOKEN to fetch source).",
  ]
    .filter(Boolean)
    .join("\n");

  const markdown = await createChatCompletion(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.1 },
  );

  const patchMatch = markdown.match(/```(?:diff)?\n([\s\S]*?)```/);
  const patch = patchMatch?.[1]?.trim() ?? markdown.split("## Suggested patch")[1]?.trim() ?? markdown;

  return {
    explanation: markdown,
    patch,
    file: primary.file,
    generatedAt: new Date().toISOString(),
    disclaimer:
      "Review before applying. Evolvex does not auto-merge — copy the patch or open a PR manually.",
  };
}
