import { describe, expect, it, vi, afterEach } from "vitest";

import { registerGithubRepositoryWebhook } from "./github-webhook-register";

describe("registerGithubRepositoryWebhook (#28)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects invalid repository format", async () => {
    const result = await registerGithubRepositoryWebhook({
      token: "ghp_testtoken123456789012345678901234",
      repositoryFullName: "not-valid",
      webhookSecret: "secret",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("owner/repo");
  });

  it("creates webhook when none exists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 42 }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await registerGithubRepositoryWebhook({
      token: "ghp_testtoken123456789012345678901234",
      repositoryFullName: "acme/payments-api",
      webhookSecret: "super-secret",
      webhookUrl: "https://api.example.com/webhooks/github",
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("created");
    expect(result.hookId).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
