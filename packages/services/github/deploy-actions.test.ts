import { describe, expect, it } from "vitest";

import { buildGithubDeployRollbackActions, githubCompareUrl } from "./deploy-actions";

describe("github deploy rollback actions (#49)", () => {
  it("builds compare and actions URLs", () => {
    const actions = buildGithubDeployRollbackActions({
      repo: "acme/payments-api",
      sha: "abc123def456",
      branch: "main",
      previousSha: "prev789",
    });

    expect(actions.commitUrl).toBe("https://github.com/acme/payments-api/commit/abc123def456");
    expect(actions.compareUrl).toBe(githubCompareUrl("acme/payments-api", "prev789", "abc123def456"));
    expect(actions.actionsUrl).toBe("https://github.com/acme/payments-api/actions");
    expect(actions.revertGuideUrl).toBe(actions.commitUrl);
  });

  it("uses parent commit for compare when previous SHA is missing", () => {
    const actions = buildGithubDeployRollbackActions({
      repo: "acme/payments-api",
      sha: "abc123def456",
    });

    expect(actions.compareUrl).toContain("abc123def456%5E");
    expect(actions.compareUrl).toContain("abc123def456");
  });
});
