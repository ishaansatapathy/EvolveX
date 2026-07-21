/**
 * agent-guard.ts
 *
 * All agent-level security controls live here so they can be tested in
 * isolation and imported without pulling in the full agent runtime.
 *
 * Layers implemented:
 *  1. Prompt-injection detection  — catches known attack patterns in the
 *     user's own message before the OpenAI call is even made.
 *  2. Email arg validation        — validates to/subject/body with the same
 *     Zod schemas used by the email-send flow so the agent can't be tricked
 *     into producing syntactically invalid or header-injected addresses.
 *  3. Per-session send cap        — limits how many "send" emails one
 *     runAgentChat call can queue, preventing "email everyone in my inbox".
 *  4. Email-content data fence    — wraps raw email body snippets in
 *     [EMAIL_DATA_START/END] so the LLM can distinguish untrusted user data
 *     from trusted instructions.
 *  5. Token-count estimation      — rough approximation to catch
 *     history-stuffing attacks before they hit the API.
 */

import { z } from "zod";
import { ServiceError } from "../errors";
import type { OpenAiConversationMessage } from "./openai-tools";

// ---------------------------------------------------------------------------
// 1. Prompt-injection detection
// ---------------------------------------------------------------------------

/**
 * Patterns that strongly indicate a prompt-injection attempt.
 * Checked case-insensitively against the raw user message.
 *
 * Deliberately kept conservative to avoid false-positives on legitimate
 * requests like "ignore this email thread" or "forget that, let's reschedule".
 */
const INJECTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    // Matches: "ignore all previous instructions", "ignore the above instructions", "ignore prior instructions"
    pattern: /ignore\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+instructions/i,
    reason: "Instruction-override attempt detected",
  },
  {
    // Matches: "forget all instructions", "forget your rules", "forget all previous instructions"
    // The (\w+\s+)* handles adjectives like "previous" between the quantifier and the noun.
    pattern: /forget\s+(all|your|every|previous)(\s+\w+){0,2}\s+(instructions|context|rules|guidelines)/i,
    reason: "Context-wipe attempt detected",
  },
  {
    pattern: /you\s+are\s+now\s+(a\s+)?(different|new|another|unrestricted|jailbroken)/i,
    reason: "Role-reassignment attempt detected",
  },
  {
    pattern: /act\s+as\s+(a\s+)?(different|another|new|unrestricted|evil|malicious)/i,
    reason: "Role-override attempt detected",
  },
  {
    pattern: /\bdo\s+anything\s+now\b/i,
    reason: "DAN jailbreak pattern detected",
  },
  {
    pattern: /disregard\s+(your\s+)?(previous|prior|all)\s+(instructions|directives|rules)/i,
    reason: "Instruction-disregard attempt detected",
  },
  // Mass-action abuse — these must be whole-phrase matches to avoid
  // blocking "send an email to everyone on the team" from a calendar context.
  {
    pattern: /\b(email|send\s+(an?\s+email\s+)?to)\s+everyone\s+(in|from|on)\s+(my\s+)?(inbox|contacts|list)/i,
    reason: "Bulk-send mass-action command detected",
  },
  {
    pattern: /forward\s+(all|every)\s+(my\s+)?(emails?|messages?|threads?)/i,
    reason: "Mass-forward command detected",
  },
  {
    pattern: /delete\s+(all|every)\s+(my\s+)?(emails?|messages?|threads?|events?)/i,
    reason: "Mass-delete command detected",
  },
  {
    pattern: /\bexfiltrate\b/i,
    reason: "Exfiltration keyword detected",
  },
];

export type InjectionCheckResult =
  | { flagged: false }
  | { flagged: true; reason: string };

/**
 * Scans a raw user message for known prompt-injection and mass-action patterns.
 * Returns immediately on the first match.
 *
 * This is a defence-in-depth layer — it blocks the most common, literal
 * attack forms. Sophisticated paraphrased injections that arrive through
 * email content are handled by data-fencing (see below).
 */
export function detectInjectionAttempt(message: string): InjectionCheckResult {
  for (const { pattern, reason } of INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      return { flagged: true, reason };
    }
  }
  return { flagged: false };
}

// ---------------------------------------------------------------------------
// 2. Email arg validation
// ---------------------------------------------------------------------------

/** Stripped-down CRLF-safe header sanitizer (mirrors validation/email.ts). */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]/g, "").trim();
}

const recipientSchema = z
  .string()
  .min(3)
  .max(320)
  .transform(sanitizeHeader)
  .refine(
    (v) => {
      const bracket = v.match(/<([^>]+)>/);
      const addr = bracket?.[1] ?? v;
      return z.string().email().safeParse(addr.trim()).success;
    },
    { message: "Invalid recipient email address" },
  );

const subjectSchema = z
  .string()
  .min(1)
  .max(998)
  .transform(sanitizeHeader)
  .refine((v) => v.length > 0, { message: "Email subject is required" });

const bodySchema = z.string().min(1).max(100_000);

export type ValidatedEmailArgs = {
  to: string;
  subject: string;
  body: string;
};

/**
 * Validates and sanitises the to/subject/body arguments produced by the LLM
 * before they reach the queue service.  Throws a ServiceError on failure so
 * the tool result returned to the LLM is a structured error, not a crash.
 */
export function validateAgentEmailArgs(args: Record<string, unknown>): ValidatedEmailArgs {
  const toResult = recipientSchema.safeParse(String(args.to ?? ""));
  if (!toResult.success) {
    throw new ServiceError(
      "BAD_REQUEST",
      `Invalid recipient address: ${toResult.error.issues[0]?.message ?? "unknown error"}`,
    );
  }

  const subjectResult = subjectSchema.safeParse(String(args.subject ?? ""));
  if (!subjectResult.success) {
    throw new ServiceError(
      "BAD_REQUEST",
      `Invalid subject: ${subjectResult.error.issues[0]?.message ?? "unknown error"}`,
    );
  }

  const bodyResult = bodySchema.safeParse(String(args.body ?? ""));
  if (!bodyResult.success) {
    throw new ServiceError(
      "BAD_REQUEST",
      `Invalid body: ${bodyResult.error.issues[0]?.message ?? "unknown error"}`,
    );
  }

  return {
    to: toResult.data,
    subject: subjectResult.data,
    body: bodyResult.data,
  };
}

// ---------------------------------------------------------------------------
// 3. Per-session send cap
// ---------------------------------------------------------------------------

/** Default maximum "send"-mode emails per runAgentChat call. */
export const DEFAULT_AGENT_SEND_CAP = 3;

export type SendCounter = { count: number };

/**
 * Increments the send counter and throws if the per-session cap is exceeded.
 * Pass the same counter object for every queue_email(mode=send) call within
 * a single runAgentChat invocation.
 */
export function enforceEmailSendCap(
  counter: SendCounter,
  cap: number = DEFAULT_AGENT_SEND_CAP,
): void {
  counter.count += 1;
  if (counter.count > cap) {
    throw new ServiceError(
      "BAD_REQUEST",
      `Agent send limit reached (max ${cap} emails per request). ` +
        `Please use the Compose tab for additional emails or break your request into multiple messages.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Email-content data fence
// ---------------------------------------------------------------------------

const DATA_FENCE_START = "[EMAIL_DATA_START]";
const DATA_FENCE_END = "[EMAIL_DATA_END]";

/**
 * Wraps raw email content (snippets, bodies) in data-fence markers so the
 * LLM can cleanly distinguish untrusted email content from trusted instructions.
 * The system prompt must instruct the model to treat fenced content as data only.
 */
export function fenceEmailData(content: string): string {
  // Strip any existing fence markers to prevent nesting attacks.
  const cleaned = content
    .replace(/\[EMAIL_DATA_START\]/g, "[DATA]")
    .replace(/\[EMAIL_DATA_END\]/g, "[/DATA]");
  return `${DATA_FENCE_START}\n${cleaned}\n${DATA_FENCE_END}`;
}

// ---------------------------------------------------------------------------
// 5. Token-count estimation
// ---------------------------------------------------------------------------

/**
 * Rough approximation: 1 token ≈ 4 chars of English text.
 * Used to guard against history-stuffing (very long conversation histories
 * that inflate context windows and costs). Not used for billing.
 */
export function estimateTokenCount(messages: OpenAiConversationMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    const content = typeof msg.content === "string" ? msg.content : "";
    chars += content.length;
    // Add overhead for role and message framing tokens (~4 each).
    chars += 16;
  }
  return Math.ceil(chars / 4);
}

/** Max estimated tokens we'll allow in a single agent call's history. */
export const MAX_AGENT_CONTEXT_TOKENS = 50_000;
