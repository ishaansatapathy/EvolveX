import { describe, expect, it } from "vitest";

import { validateDeployEnvironment } from "./preflight";

describe("deploy preflight (#45)", () => {
  it("requires core production env vars", () => {
    const result = validateDeployEnvironment({
      environment: "production",
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://example",
        JWT_SECRET: "x".repeat(32),
        JWT_REFRESH_SECRET: "y".repeat(32),
        BASE_URL: "https://api.example.com",
        CLIENT_URL: "https://app.example.com",
        API_INTERNAL_URL: "https://api.example.com",
        SKIP_ENV_VALIDATION: "false",
      },
    });

    expect(result.ok).toBe(true);
  });

  it("fails when SKIP_ENV_VALIDATION is true in production", () => {
    const result = validateDeployEnvironment({
      environment: "production",
      env: {
        DATABASE_URL: "postgresql://example",
        JWT_SECRET: "x".repeat(32),
        JWT_REFRESH_SECRET: "y".repeat(32),
        BASE_URL: "https://api.example.com",
        CLIENT_URL: "https://app.example.com",
        API_INTERNAL_URL: "https://api.example.com",
        SKIP_ENV_VALIDATION: "true",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((issue) => issue.field === "SKIP_ENV_VALIDATION")).toBe(true);
  });
});
