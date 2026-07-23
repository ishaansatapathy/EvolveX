import { describe, expect, it } from "vitest";

import { parseStackLocations, pickBestStackLocation } from "./stack-trace";

describe("stack-trace", () => {
  it("parses Go and TypeScript stack frames", () => {
    const text = `
panic: runtime error
goroutine 1 [running]:
main.handleCart(./internal/cart/lookup.go:87)
    at src/handlers/checkout.ts:142:18
    `;

    const locations = parseStackLocations(text);
    expect(locations.some((l) => l.file.includes("lookup.go") && l.line === 87)).toBe(true);
    expect(locations.some((l) => l.file.includes("checkout.ts") && l.line === 142)).toBe(true);
  });

  it("prefers application paths over vendor", () => {
    const best = pickBestStackLocation([
      { file: "vendor/foo/bar.go", line: 10, raw: "" },
      { file: "internal/cart/lookup.go", line: 87, raw: "" },
    ]);
    expect(best?.file).toContain("internal/cart");
  });
});
