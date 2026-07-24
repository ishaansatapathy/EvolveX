import { describe, expect, it } from "vitest";

import {
  PIPELINE_CACHE_VERSION,
  getPipelineCacheTtlMs,
} from "./pipeline-cache";

describe("investigation pipeline cache (#18)", () => {
  it("uses a stable pipeline cache version", () => {
    expect(PIPELINE_CACHE_VERSION).toBe(1);
  });

  it("defaults TTL to 24 hours", () => {
    const previous = process.env.INVESTIGATION_CACHE_TTL_MS;
    delete process.env.INVESTIGATION_CACHE_TTL_MS;
    expect(getPipelineCacheTtlMs()).toBe(24 * 60 * 60 * 1000);
    if (previous) process.env.INVESTIGATION_CACHE_TTL_MS = previous;
  });
});
