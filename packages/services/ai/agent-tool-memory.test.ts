import { describe, expect, it } from "vitest";

import {
  appendToolMemory,
  formatToolMemoryForPrompt,
  mergeToolMemory,
  shouldRememberTool,
  summarizeToolResult,
} from "./agent-tool-memory";

describe("agent-tool-memory", () => {
  it("remembers only high-signal read tools", () => {
    expect(shouldRememberTool("search_inbox")).toBe(true);
    expect(shouldRememberTool("queue_email")).toBe(false);
  });

  it("summarizes inbox search results", () => {
    const entry = summarizeToolResult(
      "search_inbox",
      JSON.stringify({
        count: 2,
        threads: [
          { subject: "Contract deadline", fromName: "Legal" },
          { subject: "Team sync", from: "boss@co.com" },
        ],
      }),
      { query: "contract" },
    );

    expect(entry).not.toBeNull();
    expect(entry?.tool).toBe("search_inbox");
    expect(entry?.query).toBe("contract");
    expect(entry?.summary).toContain("Contract deadline");
  });

  it("summarizes thread reads with threadId", () => {
    const entry = summarizeToolResult(
      "get_thread",
      JSON.stringify({ thread: { subject: "Sick leave", fromName: "HR" } }),
      { threadId: "thread-abc" },
    );

    expect(entry?.threadId).toBe("thread-abc");
    expect(entry?.summary).toContain("Sick leave");
  });

  it("appends and caps memory entries", () => {
    const base = Array.from({ length: 12 }, (_, i) => ({
      at: new Date().toISOString(),
      tool: "search_inbox",
      summary: `entry ${i}`,
    }));
    const next = appendToolMemory(base, {
      at: new Date().toISOString(),
      tool: "rank_inbox",
      summary: "latest",
    });

    expect(next).toHaveLength(12);
    expect(next.at(-1)?.summary).toBe("latest");
    expect(next[0]?.summary).toBe("entry 1");
  });

  it("formats memory for system prompt injection", () => {
    const text = formatToolMemoryForPrompt([
      { at: "2026-01-01T00:00:00.000Z", tool: "rank_inbox", summary: "Top: Payroll [high]" },
    ]);
    expect(text).toContain("RECENT TOOL RESULTS");
    expect(text).toContain("rank_inbox");
    expect(text).toContain("Payroll");
  });

  it("mergeToolMemory combines batches", () => {
    const merged = mergeToolMemory(
      [{ at: "1", tool: "a", summary: "one" }],
      [{ at: "2", tool: "b", summary: "two" }],
    );
    expect(merged).toHaveLength(2);
  });
});
