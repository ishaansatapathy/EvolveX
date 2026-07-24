import { eq } from "@repo/database";
import { db } from "@repo/database";
import { investigationEmbeddingsTable } from "@repo/database/schema";
import { logger } from "@repo/logger";

import { createTextEmbedding, getEmbeddingModel } from "../ai/embeddings";

export { rankEmbeddingCandidates, scoreEmbeddingSimilarity } from "./embeddings-math";
export type { EmbeddingCandidate } from "./embeddings-math";

export function buildInvestigationEmbeddingText(input: {
  title: string;
  summary?: string | null;
  alertName?: string | null;
  primaryService?: string | null;
  affectedServices?: string[];
}) {
  return [
    input.title,
    input.alertName ? `Alert: ${input.alertName}` : null,
    input.primaryService ? `Service: ${input.primaryService}` : null,
    input.affectedServices?.length ? `Affected: ${input.affectedServices.join(", ")}` : null,
    input.summary,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function persistInvestigationEmbedding(
  investigationId: string,
  sourceText: string,
): Promise<void> {
  const trimmed = sourceText.trim();
  if (!trimmed) return;

  try {
    const embedding = await createTextEmbedding(trimmed);
    if (!embedding) return;

    const model = getEmbeddingModel();

    await db
      .insert(investigationEmbeddingsTable)
      .values({
        investigationId,
        model,
        embedding,
        sourceText: trimmed.slice(0, 512),
      })
      .onConflictDoUpdate({
        target: investigationEmbeddingsTable.investigationId,
        set: {
          model,
          embedding,
          sourceText: trimmed.slice(0, 512),
        },
      });
  } catch (error) {
    logger.warn("Failed to persist investigation embedding", {
      investigationId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function loadInvestigationEmbedding(investigationId: string) {
  const [row] = await db
    .select()
    .from(investigationEmbeddingsTable)
    .where(eq(investigationEmbeddingsTable.investigationId, investigationId))
    .limit(1);

  return row ?? null;
}
