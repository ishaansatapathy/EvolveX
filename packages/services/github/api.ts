const GITHUB_API = "https://api.github.com";

function githubHeaders(token?: string | null): HeadersInit {
  const resolved = token?.trim() || process.env.GITHUB_TOKEN?.trim();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Evolvex-Investigation-OS",
  };
  if (resolved) headers.Authorization = `Bearer ${resolved}`;
  return headers;
}

export function isGithubApiConfigured(token?: string | null) {
  return Boolean(token?.trim() || process.env.GITHUB_TOKEN?.trim());
}

export type GithubCommitFile = {
  filename: string;
  status: string;
  patch?: string;
  additions: number;
  deletions: number;
};

/** Fetch files changed in a commit via GitHub REST API. Requires GITHUB_TOKEN for private repos. */
export async function fetchCommitChangedFiles(
  repo: string,
  sha: string,
  token?: string | null,
): Promise<GithubCommitFile[]> {
  const url = `${GITHUB_API}/repos/${repo}/commits/${sha}`;
  const response = await fetch(url, { headers: githubHeaders(token) });

  if (!response.ok) return [];

  const json = (await response.json()) as {
    files?: Array<{
      filename?: string;
      status?: string;
      patch?: string;
      additions?: number;
      deletions?: number;
    }>;
  };

  return (json.files ?? [])
    .filter((f) => f.filename)
    .map((f) => ({
      filename: f.filename!,
      status: f.status ?? "modified",
      patch: f.patch,
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
    }));
}

/** Fetch raw file content at a ref (commit SHA or branch). */
export async function fetchRepoFileContent(
  repo: string,
  path: string,
  ref: string,
  token?: string | null,
): Promise<string | null> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const url = `${GITHUB_API}/repos/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`;
  const response = await fetch(url, { headers: githubHeaders(token) });

  if (!response.ok) return null;

  const json = (await response.json()) as { content?: string; encoding?: string };
  if (json.encoding !== "base64" || !json.content) return null;

  return Buffer.from(json.content, "base64").toString("utf8");
}

export function githubBlobUrl(repo: string, ref: string, file: string, line?: number) {
  const base = `https://github.com/${repo}/blob/${ref}/${file}`;
  return line ? `${base}#L${line}` : base;
}

export function githubCommitUrl(repo: string, sha: string) {
  return `https://github.com/${repo}/commit/${sha}`;
}
