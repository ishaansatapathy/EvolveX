import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { buildIntegrationHealth } from "./status";

describe("buildIntegrationHealth", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it("marks core integrations missing when env is empty", () => {
    delete process.env.SIGNOZ_CLOUD_URL;
    delete process.env.SIGNOZ_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATABASE_URL;

    const result = buildIntegrationHealth();
    const signoz = result.integrations.find((item) => item.id === "signoz_api");
    const openai = result.integrations.find((item) => item.id === "openai");

    expect(signoz?.status).toBe("missing");
    expect(openai?.status).toBe("missing");
    expect(result.readyCount).toBeLessThan(result.totalCount);
  });

  it("marks signoz webhook partial when API is set but secret is missing", () => {
    process.env.SIGNOZ_CLOUD_URL = "https://signoz.example.com";
    process.env.SIGNOZ_API_KEY = "test-key";
    delete process.env.SIGNOZ_WEBHOOK_SECRET;

    const result = buildIntegrationHealth();
    const webhook = result.integrations.find((item) => item.id === "signoz_webhook");

    expect(webhook?.status).toBe("partial");
    expect(webhook?.configured).toBe(true);
    expect(webhook?.authConfigured).toBe(false);
  });

  it("reflects live database probe results", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@ep-test.neon.tech/neondb";

    const connected = buildIntegrationHealth({ databaseConnected: true });
    const failed = buildIntegrationHealth({ databaseConnected: false });

    expect(connected.integrations.find((item) => item.id === "database")?.status).toBe("ready");
    expect(failed.integrations.find((item) => item.id === "database")?.status).toBe("partial");
  });
});
