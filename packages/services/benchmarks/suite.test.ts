import { describe, expect, it } from "vitest";

import { runBenchmarkSuite } from "./suite";

describe("benchmark suite (#41)", () => {
  it("runs core micro-benchmarks", async () => {
    const result = await runBenchmarkSuite();
    expect(result.results.length).toBeGreaterThanOrEqual(4);
    expect(result.summary).toContain("Slowest:");
    for (const row of result.results) {
      expect(row.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
