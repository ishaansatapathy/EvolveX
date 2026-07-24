import { loadInvestigationEmbedding } from "../../investigation/embeddings";
import type { TelemetryIntelligenceSnapshot } from "../types";

/** Feature #9 bridge — persist vector metadata alongside TI snapshot. */
export async function attachTelemetryIntelligenceSnapshot(
  investigationId: string,
  snapshot: TelemetryIntelligenceSnapshot,
) {
  const { eq } = await import("@repo/database");
  const { db } = await import("@repo/database");
  const { investigationsTable } = await import("@repo/database/schema");

  const embedding = await loadInvestigationEmbedding(investigationId);

  await db
    .update(investigationsTable)
    .set({
      telemetryIntelligence: {
        ...snapshot,
        vectorContext: embedding
          ? { model: embedding.model, dimensions: embedding.embedding.length }
          : null,
      },
      updatedAt: new Date(),
    })
    .where(eq(investigationsTable.id, investigationId));
}
