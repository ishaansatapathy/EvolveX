import { describe, expect, it } from "vitest";

import { runDeployCheck } from "./check";

describe("deploy check (#45)", () => {
  it("passes preflight-only when base URL is omitted", async () => {
    const result = await runDeployCheck({
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
      baseUrl: null,
    });

    expect(result.preflight.ok).toBe(true);
    expect(result.smoke).toBeNull();
    expect(result.ok).toBe(true);
  });
});
