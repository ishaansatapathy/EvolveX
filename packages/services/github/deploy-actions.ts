export type GithubDeployRollbackActions = {
  commitUrl: string;
  compareUrl: string;
  actionsUrl: string;
  revertGuideUrl: string;
};

export function githubCompareUrl(repo: string, base: string, head: string) {
  return `https://github.com/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
}

/** Feature #49 — one-click GitHub links for deploy rollback workflows. */
export function buildGithubDeployRollbackActions(input: {
  repo: string;
  sha: string;
  branch?: string | null;
  previousSha?: string | null;
}): GithubDeployRollbackActions {
  const commitUrl = `https://github.com/${input.repo}/commit/${input.sha}`;
  const compareBase = input.previousSha?.trim() || `${input.sha}^`;
  const compareHead = input.sha;

  return {
    commitUrl,
    compareUrl: githubCompareUrl(input.repo, compareBase, compareHead),
    actionsUrl: `https://github.com/${input.repo}/actions`,
    revertGuideUrl: commitUrl,
  };
}
