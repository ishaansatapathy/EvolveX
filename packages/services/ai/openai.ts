import { ServiceError } from "../errors";

import { fetchOpenAi } from "./openai-fetch";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 60_000;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getOpenAiModel() {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

export async function createChatCompletion(
  messages: ChatMessage[],
  opts?: { temperature?: number; jsonObject?: boolean },
) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ServiceError("PRECONDITION_FAILED", "OpenAI is not configured. Set OPENAI_API_KEY.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchOpenAi(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: getOpenAiModel(),
          messages,
          temperature: opts?.temperature ?? 0.2,
          ...(opts?.jsonObject ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
      },
      { label: "openai.chat.completions" },
    );

    const payload = (await response.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    if (!response.ok) {
      throw new ServiceError(
        "INTERNAL",
        payload.error?.message?.trim() || "OpenAI request failed. Try again shortly.",
      );
    }

    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new ServiceError("INTERNAL", "OpenAI returned an empty response.");
    }

    return content;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ServiceError("INTERNAL", "OpenAI request timed out.");
    }
    throw new ServiceError("INTERNAL", "OpenAI request failed. Try again shortly.");
  } finally {
    clearTimeout(timeout);
  }
}
