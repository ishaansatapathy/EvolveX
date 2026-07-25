import { describe, expect, it } from "vitest";
import { generateOpenApiDocument } from "trpc-to-openapi";

import { openApiRouter } from "@repo/trpc/server";

describe("OpenAPI document generation", () => {
  it("generates without throwing (path params must match input keys)", () => {
    const doc = generateOpenApiDocument(openApiRouter, {
      title: "Evolvex API",
      version: "1.0.0",
      baseUrl: "http://localhost:8000/api",
    });

    expect(Object.keys(doc.paths ?? {}).length).toBeGreaterThan(0);
    expect(doc.paths?.["/telemetry-intelligence/investigations/{investigationId}/insights"]).toBeDefined();
  });
});
