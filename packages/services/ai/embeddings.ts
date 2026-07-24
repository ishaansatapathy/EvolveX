import { ServiceError } from "../errors";

import { fetchOpenAi } from "./openai-fetch";
import { isOpenAiConfigured } from "./openai";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export function getEmbeddingModel() {
  return process.env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

export function isEmbeddingConfigured() {
  return isOpenAiConfigured();
}

/** Creates a vector embedding for semantic incident similarity search. */
export async function createTextEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || !text.trim()) return null;

  const response = await fetchOpenAi(
    "https://api.openai.com/v1/embeddings",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getEmbeddingModel(),
        input: text.slice(0, 8000),
      }),
    },
    { label: "openai.embeddings" },
  );

  const payload = (await response.json()) as {
    error?: { message?: string };
    data?: Array<{ embedding?: number[] }>;
  };

  if (!response.ok) {
    throw new ServiceError(
      "INTERNAL",
      payload.error?.message ?? `OpenAI embeddings failed (${response.status})`,
    );
  }

  return payload.data?.[0]?.embedding ?? null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index++) {
    dot += a[index]! * b[index]!;
    normA += a[index]! * a[index]!;
    normB += b[index]! * b[index]!;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
