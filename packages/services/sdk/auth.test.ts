import { describe, expect, it } from "vitest";

import { verifyEvolvexApiKey, extractBearerToken } from "./auth";

describe("sdk auth (#57)", () => {
  it("extracts bearer tokens", () => {
    expect(extractBearerToken("Bearer evx_test")).toBe("evx_test");
    expect(extractBearerToken("evx_plain")).toBe("evx_plain");
  });

  it("allows development mode without configured key", () => {
    const previous = process.env.EVOLVEX_API_KEY;
    const previousNode = process.env.NODE_ENV;
    delete process.env.EVOLVEX_API_KEY;
    process.env.NODE_ENV = "development";

    expect(verifyEvolvexApiKey(undefined).authenticated).toBe(true);

    process.env.EVOLVEX_API_KEY = previous;
    process.env.NODE_ENV = previousNode;
  });
});
