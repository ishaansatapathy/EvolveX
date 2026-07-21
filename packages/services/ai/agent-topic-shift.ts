import type { AgentFocus } from "./agent-focus";
import type { AgentToolMemoryEntry } from "./agent-tool-memory";

export type TopicShiftResult = {
  shouldClearFocus: boolean;
  reason?: "calendar_intent" | "inbox_intent" | "new_search" | "explicit_new_topic";
};

const DEICTIC_RE = /\b(this|these|that|it|same one|above|below)\b/i;
const CALENDAR_INTENT_RE =
  /\b(calendar|meeting|meetings|schedule|scheduled|appointment|appointments|event|events|tomorrow at|next week|this week|availability|free slot)\b/i;
const INBOX_INTENT_RE =
  /\b(inbox|email|emails|thread|threads|mail|reply|replies|draft|sender|unread|gmail)\b/i;
const NEW_SEARCH_RE = /\b(search|find|look up|lookup|rank|show me|list my|what(?:'s| is) in)\b/i;

function recentMemoryTopics(memory: AgentToolMemoryEntry[]): string {
  return memory
    .slice(-4)
    .map((m) => m.summary)
    .join(" ")
    .toLowerCase();
}

/**
 * Heuristic topic-shift detection — clears stale thread/event focus when the user
 * clearly moves to a different domain or starts a fresh search without deictics.
 */
export function detectTopicShift(
  message: string,
  focus: AgentFocus | undefined,
  toolMemory: AgentToolMemoryEntry[] = [],
): TopicShiftResult {
  if (!focus?.threadId?.trim() && !focus?.eventId?.trim()) {
    return { shouldClearFocus: false };
  }

  const trimmed = message.trim();
  if (!trimmed) return { shouldClearFocus: false };

  if (DEICTIC_RE.test(trimmed)) {
    return { shouldClearFocus: false };
  }

  const lower = trimmed.toLowerCase();
  const hasCalendar = CALENDAR_INTENT_RE.test(lower);
  const hasInbox = INBOX_INTENT_RE.test(lower);

  if (focus.threadId?.trim() && hasCalendar && !hasInbox) {
    return { shouldClearFocus: true, reason: "calendar_intent" };
  }

  if (focus.eventId?.trim() && hasInbox && !hasCalendar) {
    return { shouldClearFocus: true, reason: "inbox_intent" };
  }

  if (NEW_SEARCH_RE.test(trimmed)) {
    const memoryBlob = recentMemoryTopics(toolMemory);
    const tokens = lower
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3 && !["search", "find", "show", "list", "what", "inbox", "email"].includes(w));

    const overlapsMemory = tokens.some((t) => memoryBlob.includes(t));
    if (!overlapsMemory && (trimmed.length >= 28 || /\bfor\b/i.test(trimmed) || /\babout\b/i.test(trimmed))) {
      return { shouldClearFocus: true, reason: "new_search" };
    }
  }

  if (
    (focus.threadId || focus.eventId) &&
    trimmed.length >= 40 &&
    !hasCalendar &&
    !hasInbox &&
    !DEICTIC_RE.test(trimmed)
  ) {
    return { shouldClearFocus: true, reason: "explicit_new_topic" };
  }

  return { shouldClearFocus: false };
}
