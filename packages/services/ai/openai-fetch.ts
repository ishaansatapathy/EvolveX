/**
 * OpenAI fetch with exponential backoff on 429 / 5xx.
 * Mirrors packages/services/cache/retry.ts for Corsair calls.
 */
import { logger } from "@repo/logger";

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, 15_000);
    }
  }
  const jitter = Math.random() * 100;
  return Math.min(400 * 2 ** (attempt - 1) + jitter, 10_000);
}

export async function fetchOpenAi(
  url: string,
  init: RequestInit,
  opts?: { maxAttempts?: number; label?: string },
): Promise<Response> {
  const maxAttempts = opts?.maxAttempts ?? 4;
  const label = opts?.label ?? "openai.chat";

  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, init);
    lastResponse = response;

    if (response.ok || !TRANSIENT_STATUSES.has(response.status) || attempt === maxAttempts) {
      return response;
    }

    const waitMs = retryDelayMs(response, attempt);
    logger.warn(`[openai-retry] ${label} HTTP ${response.status} — retry ${attempt}/${maxAttempts} in ${Math.round(waitMs)}ms`);
    await delay(waitMs);
  }

  return lastResponse!;
}
