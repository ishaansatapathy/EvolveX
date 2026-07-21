import { describe, expect, it, vi, afterEach } from "vitest";

import { analyzeInboxThreads, rankInboxThreads } from "./inbox-priority";

describe("rankInboxThreads", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns input order for a single thread without calling OpenAI", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const ids = await rankInboxThreads([{ id: "t1", snippet: "Hello" }]);
    expect(ids).toEqual(["t1"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when OpenAI is not configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(
      rankInboxThreads([
        { id: "t1", snippet: "A" },
        { id: "t2", snippet: "B" },
      ]),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("appends missing ids when the model omits some threads", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      id: "t2",
                      urgency: "critical",
                      score: 95,
                      reason: "Contract deadline mentioned in subject.",
                      category: "deadline",
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const analysis = await analyzeInboxThreads([
      { id: "t1", snippet: "Low priority newsletter" },
      { id: "t2", snippet: "URGENT: contract due today" },
    ]);

    expect(analysis.rankedIds).toEqual(["t2", "t1"]);
    expect(analysis.items[0]).toMatchObject({ id: "t2", urgency: "critical", score: 95 });
    expect(analysis.items[1]?.id).toBe("t1");
  });
});
