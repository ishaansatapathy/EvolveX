import { loadInvestigationEmbedding, persistInvestigationEmbedding } from "../../investigation/embeddings";
import type { TelemetryIntelligenceSnapshot } from "../types";

export function buildTelemetryIntelligenceEmbeddingText(snapshot: TelemetryIntelligenceSnapshot) {
  const enrichment = snapshot.alertEnrichment;
  return [
    enrichment?.alertName ? `Alert: ${enrichment.alertName}` : null,
    enrichment?.serviceNames.length ? `Services: ${enrichment.serviceNames.join(", ")}` : null,
    enrichment?.classification.kind ? `Classification: ${enrichment.classification.kind}` : null,
    `Intelligence state: ${snapshot.intelligenceState}`,
    snapshot.samplingPolicies.length
      ? `Sampling: ${snapshot.samplingPolicies.map((policy) => `${policy.serviceName}:${policy.mode}`).join(", ")}`
      : null,
    snapshot.serviceMapCorrelation?.affectedServices.length
      ? `Affected graph: ${snapshot.serviceMapCorrelation.affectedServices.join(", ")}`
      : null,
    enrichment?.enrichmentNotes.join(" · "),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Feature #9 — persist telemetry signature embedding alongside TI snapshot. */
export async function attachTelemetryIntelligenceSnapshot(
  investigationId: string,
  snapshot: TelemetryIntelligenceSnapshot,
) {
  const { eq } = await import("@repo/database");
  const { db } = await import("@repo/database");
  const { investigationsTable } = await import("@repo/database/schema");

  const signatureText = buildTelemetryIntelligenceEmbeddingText(snapshot);
  let embedding = await loadInvestigationEmbedding(investigationId);

  if (!embedding && signatureText.trim()) {
    await persistInvestigationEmbedding(investigationId, signatureText);
    embedding = await loadInvestigationEmbedding(investigationId);
  }

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
