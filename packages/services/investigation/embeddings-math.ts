import { cosineSimilarity } from "../ai/embeddings";

export type EmbeddingCandidate = {
  investigationId: string;
  embedding: number[];
};

export function scoreEmbeddingSimilarity(base: number[], candidate: number[]) {
  const similarity = cosineSimilarity(base, candidate);
  return Math.round(Math.max(0, Math.min(1, similarity)) * 100);
}

/** Ranks candidate investigations by vector similarity to a base embedding. */
export function rankEmbeddingCandidates(base: number[], candidates: EmbeddingCandidate[], limit = 5) {
  return candidates
    .map((candidate) => ({
      investigationId: candidate.investigationId,
      similarityScore: scoreEmbeddingSimilarity(base, candidate.embedding),
    }))
    .filter((item) => item.similarityScore >= 55)
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, limit);
}
