import { db } from "@repo/database";
import { investigationSummariesTable } from "@repo/database/schema";

import { createChatCompletion, getOpenAiModel, isOpenAiConfigured } from "../ai/openai";
import { logger } from "@repo/logger";
import {
  formatEvidenceBlockWithCitationRefs,
  formatTimelineBlockWithCitationRefs,
} from "./evidence-citations";

export type SummaryEvidenceInput = {
  investigationId: string;
  title: string;
  summary: string;
  affectedServices: string[];
  timeline: Array<{
    id: string;
    kind: string;
    title: string;
    detail: string;
    occurredAt: string;
    source?: string | null;
  }>;
  evidence: Array<{
    type: string;
    description: string;
    occurredAt: string;
  }>;
  changeEvents: Array<{
    type: string;
    service: string | null;
    author: string | null;
    occurredAt: string;
  }>;
  runtimeSignalCount: number;
  structuredEvidenceBlock?: string;
  incidentNarrativeBlock?: string;
};

function formatChangeBlock(
  changeEvents: SummaryEvidenceInput["changeEvents"],
): string {
  if (changeEvents.length === 0) return "(no change events)";
  return changeEvents
    .map(
      (event) =>
        `- [${event.type}] ${event.service ?? "unknown service"}${event.author ? ` by ${event.author}` : ""} at ${event.occurredAt}`,
    )
    .join("\n");
}

/**
 * Generates an LLM root-cause summary from assembled investigation evidence.
 * Returns null when OpenAI is not configured — never fabricates a summary.
 */
export async function generateAndPersistInvestigationSummary(
  input: SummaryEvidenceInput,
): Promise<{ markdown: string; generatedAt: Date } | null> {
  if (!isOpenAiConfigured()) {
    logger.info("Skipping LLM summary — OPENAI_API_KEY not configured", {
      investigationId: input.investigationId,
    });
    return null;
  }

  if (input.timeline.length === 0) {
    logger.info("Skipping LLM summary — no timeline evidence", {
      investigationId: input.investigationId,
    });
    return null;
  }

  const systemPrompt = [
    "You are a senior SRE writing an incident investigation summary.",
    "Use ONLY facts present in the provided evidence.",
    "Do not invent deployments, metrics, root causes, or services not mentioned.",
    "If evidence is inconclusive, state what is known and list concrete next steps.",
    "Respond in markdown with sections: ## Summary, ## Likely cause, ## Supporting evidence, ## Recommended next steps.",
    "In Likely cause and Supporting evidence, cite timeline/evidence refs inline using exact markers like [T1] or [E2] from the provided lists.",
    "Do not invent citation IDs.",
  ].join(" ");

  const userPrompt = [
    `Investigation: ${input.title}`,
    `Affected services: ${input.affectedServices.join(", ") || "unknown"}`,
    `Rule-based context: ${input.summary}`,
    `Runtime signals stored: ${input.runtimeSignalCount}`,
    "",
    "Citable timeline (use [T1], [T2], ...):",
    formatTimelineBlockWithCitationRefs(input.timeline),
    "",
    "Citable evidence store (use [E1], [E2], ...):",
    formatEvidenceBlockWithCitationRefs(input.evidence),
    "",
    "Change events:",
    formatChangeBlock(input.changeEvents),
    "",
    "Structured evidence:",
    input.structuredEvidenceBlock ?? "(not available)",
    "",
    "Incident narrative:",
    input.incidentNarrativeBlock ?? "(not available)",
  ].join("\n");

  const markdown = await createChatCompletion(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.15 },
  );

  const generatedAt = new Date();

  await db.insert(investigationSummariesTable).values({
    investigationId: input.investigationId,
    markdown,
    generatedAt,
    metadata: {
      model: getOpenAiModel(),
      source: "openai",
      timelineEntryCount: input.timeline.length,
      changeEventCount: input.changeEvents.length,
    },
  });

  return { markdown, generatedAt };
}
