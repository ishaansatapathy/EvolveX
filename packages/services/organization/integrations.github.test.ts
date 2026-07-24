import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

vi.mock("@repo/database", () => ({
  db: {},
  eq: vi.fn(),
  and: vi.fn(),
}));

vi.mock("@repo/database/schema", () => ({
  organizationIntegrationsTable: {},
  organizationMembersTable: {},
}));

import { testGithubIntegration } from "./integrations";

describe("testGithubIntegration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GITHUB_TOKEN;
  });

  it("reports missing token with setup hint", async () => {
    const result = await testGithubIntegration(null);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not configured");
  });

  it("rejects invalid token format before calling GitHub", async () => {
    process.env.GITHUB_TOKEN = "not-a-real-token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await testGithubIntegration(null);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("format looks invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns login and scope details on success", async () => {
    process.env.GITHUB_TOKEN = "ghp_testtoken123456789012345678901234";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get(name: string) {
            if (name === "x-oauth-scopes") return "repo, read:user";
            if (name === "x-ratelimit-remaining") return "4999";
            return null;
          },
        },
        json: async () => ({ login: "demo-user" }),
      }),
    );

    const result = await testGithubIntegration(null);

    expect(result.ok).toBe(true);
    expect(result.login).toBe("demo-user");
    expect(result.hasRepoScope).toBe(true);
    expect(result.message).toContain("@demo-user");
    expect(result.message).toContain("repo");
  });
});
