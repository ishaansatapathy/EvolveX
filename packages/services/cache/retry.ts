/**
 * Lightweight exponential-backoff retry wrapper for Corsair / Google API calls.
 *
 * Retries on transient errors:
 *  - HTTP 429 (rate limit) — up to 4 attempts
 *  - HTTP 5xx (server error) — up to 3 attempts
 *  - Network errors (ECONNRESET, ETIMEDOUT, ENOTFOUND)
 *
 * Non-retriable errors (4xx except 429, auth errors) are thrown immediately.
 */

import { logger } from "@repo/logger";

export interface RetryOptions {
  /** Maximum total attempts (default 3). */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff (default 300). */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default 8000). */
  maxDelayMs?: number;
  /** Label for log lines (e.g. "threads.list"). */
  label?: string;
}

const TRANSIENT_HTTP_CODES = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ENETUNREACH", "EAI_AGAIN"]);

function isTransient(error: unknown): boolean {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && TRANSIENT_CODES.has(code)) return true;
    // Corsair / axios errors carry a status field
    const status = (error as { status?: number; response?: { status?: number } }).status
      ?? (error as { response?: { status?: number } }).response?.status;
    if (status !== undefined && TRANSIENT_HTTP_CODES.has(status)) return true;
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute `fn` with exponential backoff retry on transient errors.
 *
 * @example
 * ```ts
 * const thread = await withRetry(
 *   () => corsair.gmail.api.threads.get({ userId: "me", id: threadId }),
 *   { maxAttempts: 3, label: "threads.get" },
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 300, maxDelayMs = 8000, label = "corsair" } = opts;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isTransient(error)) {
        throw error;
      }
      const jitter = Math.random() * 100;
      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1) + jitter, maxDelayMs);
      logger.warn(`[retry] ${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${Math.round(backoff)}ms`, {
        error: error instanceof Error ? error.message : String(error),
      });
      await delay(backoff);
    }
  }
  throw lastError;
}
