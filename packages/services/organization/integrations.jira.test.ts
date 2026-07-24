import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@repo/database", () => ({
  db: {},
  eq: vi.fn(),
  and: vi.fn(),
}));

vi.mock("@repo/database/schema", () => ({
  organizationIntegrationsTable: {},
  organizationMembersTable: {},
}));

import { testJiraIntegration } from "./integrations";

describe("testJiraIntegration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.JIRA_BASE_URL;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
    delete process.env.JIRA_PROJECT_KEY;
  });

  it("reports missing config with setup hint", async () => {
    const result = await testJiraIntegration(null);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not configured");
  });

  it("returns account details on success", async () => {
    process.env.JIRA_BASE_URL = "https://demo.atlassian.net";
    process.env.JIRA_EMAIL = "demo@company.com";
    process.env.JIRA_API_TOKEN = "secret-token";
    process.env.JIRA_PROJECT_KEY = "ENG";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ displayName: "Demo User" }),
      }),
    );

    const result = await testJiraIntegration(null);

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Demo User");
    expect(result.message).toContain("ENG");
  });
});
