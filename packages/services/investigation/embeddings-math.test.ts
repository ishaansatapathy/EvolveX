import { describe, expect, it } from "vitest";

import { cosineSimilarity } from "../ai/embeddings";
import { rankEmbeddingCandidates, scoreEmbeddingSimilarity } from "./embeddings-math";

describe("investigation embeddings", () => {
  it("scores identical vectors as 100", () => {
    const vector = [1, 0, 0];
    expect(scoreEmbeddingSimilarity(vector, vector)).toBe(100);
    expect(cosineSimilarity(vector, vector)).toBe(1);
  });

  it("ranks candidates by similarity", () => {
    const ranked = rankEmbeddingCandidates(
      [1, 0, 0],
      [
        { investigationId: "a", embedding: [1, 0, 0] },
        { investigationId: "b", embedding: [0, 1, 0] },
      ],
      2,
    );

    expect(ranked[0]?.investigationId).toBe("a");
    expect(ranked[0]?.similarityScore).toBe(100);
  });
});
