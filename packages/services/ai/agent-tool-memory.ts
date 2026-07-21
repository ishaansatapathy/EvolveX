export type AgentToolMemoryEntry = {
  at: string;
  tool: string;
  summary: string;
  threadId?: string;
  eventId?: string;
  query?: string;
};

export const MAX_TOOL_MEMORY_ENTRIES = 12;

const MEMORY_TOOLS = new Set([
  "search_inbox",
  "list_inbox",
  "get_thread",
  "summarize_thread",
  "rank_inbox",
  "list_calendar_events",
  "get_calendar_event",
  "list_queue",
]);

export function shouldRememberTool(toolName: string): boolean {
  return MEMORY_TOOLS.has(toolName);
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function clip(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function summarizeToolResult(
  toolName: string,
  rawResult: string,
  args: Record<string, unknown>,
): AgentToolMemoryEntry | null {
  if (!shouldRememberTool(toolName)) return null;

  const at = new Date().toISOString();
  const data = safeParseJson(rawResult);
  const threadId = typeof args.threadId === "string" ? args.threadId.trim() : undefined;
  const eventId = typeof args.eventId === "string" ? args.eventId.trim() : undefined;
  const query = typeof args.query === "string" ? args.query.trim() : undefined;

  switch (toolName) {
    case "search_inbox":
    case "list_inbox": {
      const count = typeof data?.count === "number" ? data.count : undefined;
      const threads = Array.isArray(data?.threads) ? data.threads : [];
      const topSubjects = threads
        .slice(0, 3)
        .map((t) => {
          if (!t || typeof t !== "object") return "";
          const row = t as Record<string, unknown>;
          const subject = typeof row.subject === "string" ? row.subject.trim() : "";
          const from = typeof row.fromName === "string" ? row.fromName : typeof row.from === "string" ? row.from : "";
          return subject ? `${subject}${from ? ` (${from})` : ""}` : "";
        })
        .filter(Boolean);
      const summary = query
        ? `Searched inbox for "${query}" — ${count ?? threads.length} thread(s)${topSubjects.length ? `: ${topSubjects.join("; ")}` : ""}`
        : `Listed ${count ?? threads.length} recent inbox thread(s)${topSubjects.length ? `: ${topSubjects.join("; ")}` : ""}`;
      return { at, tool: toolName, summary: clip(summary), query };
    }

    case "get_thread": {
      const thread =
        data?.thread && typeof data.thread === "object" ? (data.thread as Record<string, unknown>) : null;
      const subject = typeof thread?.subject === "string" ? thread.subject.trim() : "Thread";
      const from =
        typeof thread?.fromName === "string"
          ? thread.fromName
          : typeof thread?.from === "string"
            ? thread.from
            : "";
      return {
        at,
        tool: toolName,
        summary: clip(`Read thread "${subject}"${from ? ` from ${from}` : ""}`),
        threadId,
      };
    }

    case "summarize_thread": {
      const subject = typeof data?.subject === "string" ? data.subject.trim() : "Thread";
      const next = typeof data?.nextStep === "string" ? data.nextStep.trim() : "";
      return {
        at,
        tool: toolName,
        summary: clip(`Summarized "${subject}"${next ? ` — next: ${next}` : ""}`),
        threadId,
      };
    }

    case "rank_inbox": {
      const items = Array.isArray(data?.items) ? data.items : [];
      const top = items
        .slice(0, 3)
        .map((item) => {
          if (!item || typeof item !== "object") return "";
          const row = item as Record<string, unknown>;
          const subject = typeof row.subject === "string" ? row.subject.trim() : "";
          const urgency = typeof row.urgency === "string" ? row.urgency : "";
          return subject ? `${subject} [${urgency}]` : "";
        })
        .filter(Boolean);
      return {
        at,
        tool: toolName,
        summary: clip(`Ranked inbox urgency${top.length ? `: ${top.join("; ")}` : ""}`),
      };
    }

    case "list_calendar_events": {
      const events = Array.isArray(data?.events) ? data.events : [];
      const top = events
        .slice(0, 3)
        .map((e) => {
          if (!e || typeof e !== "object") return "";
          const row = e as Record<string, unknown>;
          return typeof row.summary === "string" ? row.summary.trim() : "";
        })
        .filter(Boolean);
      return {
        at,
        tool: toolName,
        summary: clip(`Listed ${events.length} calendar event(s)${top.length ? `: ${top.join("; ")}` : ""}`),
      };
    }

    case "get_calendar_event": {
      const event =
        data?.event && typeof data.event === "object" ? (data.event as Record<string, unknown>) : null;
      const title = typeof event?.summary === "string" ? event.summary.trim() : "Event";
      const start = typeof event?.start === "string" ? event.start : "";
      return {
        at,
        tool: toolName,
        summary: clip(`Read calendar event "${title}"${start ? ` at ${start}` : ""}`),
        eventId,
      };
    }

    case "list_queue": {
      const items = Array.isArray(data?.items) ? data.items : [];
      return {
        at,
        tool: toolName,
        summary: clip(`Queue has ${items.length} pending item(s)`),
      };
    }

    default:
      return { at, tool: toolName, summary: clip(`${toolName} completed`) };
  }
}

export function appendToolMemory(
  existing: AgentToolMemoryEntry[],
  entry: AgentToolMemoryEntry,
): AgentToolMemoryEntry[] {
  return [...existing, entry].slice(-MAX_TOOL_MEMORY_ENTRIES);
}

export function mergeToolMemory(
  existing: AgentToolMemoryEntry[],
  newEntries: AgentToolMemoryEntry[],
): AgentToolMemoryEntry[] {
  if (newEntries.length === 0) return existing;
  return [...existing, ...newEntries].slice(-MAX_TOOL_MEMORY_ENTRIES);
}

export function formatToolMemoryForPrompt(entries: AgentToolMemoryEntry[]): string {
  if (!entries.length) return "";

  const lines = entries.map((e) => {
    const parts = [`- [${e.tool}] ${e.summary}`];
    if (e.threadId) parts.push(`threadId=${e.threadId}`);
    if (e.eventId) parts.push(`eventId=${e.eventId}`);
    if (e.query) parts.push(`query="${e.query}"`);
    return parts.join(" ");
  });

  return [
    "",
    "═══ RECENT TOOL RESULTS (structured memory — prefer over stale chat topics) ═══",
    ...lines,
    "When the user asks follow-up questions without naming a new subject, use these results before re-searching.",
  ].join("\n");
}
