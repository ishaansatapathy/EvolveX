import { z } from "zod";

export const githubPushPayloadSchema = z.object({
  ref: z.string().optional(),
  repository: z
    .object({
      full_name: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  pusher: z
    .object({
      name: z.string().optional(),
    })
    .optional(),
  head_commit: z
    .object({
      id: z.string().optional(),
      message: z.string().optional(),
      timestamp: z.string().optional(),
      author: z
        .object({
          name: z.string().optional(),
          username: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type GithubPushPayload = z.infer<typeof githubPushPayloadSchema>;

export function parseGithubDeployEvent(payload: GithubPushPayload) {
  const repo = payload.repository?.full_name ?? payload.repository?.name ?? "unknown-repo";
  const branch = payload.ref?.replace("refs/heads/", "") ?? "main";
  const fullSha = payload.head_commit?.id ?? "unknown";
  const sha = fullSha === "unknown" ? fullSha : fullSha.slice(0, 7);
  const message = payload.head_commit?.message?.split("\n")[0]?.trim() ?? "Deploy push";
  const author =
    payload.head_commit?.author?.username ??
    payload.head_commit?.author?.name ??
    payload.pusher?.name ??
    "unknown";
  const occurredAt = payload.head_commit?.timestamp
    ? new Date(payload.head_commit.timestamp)
    : new Date();

  return {
    repo,
    branch,
    sha,
    fullSha,
    message,
    author,
    occurredAt,
    title: `Deploy ${repo}@${sha}`,
    detail: `${message} — pushed by ${author} to ${branch}`,
  };
}

/** Maps a GitHub repo slug to a likely SigNoz service.name (Feature #49). */
export function inferServiceNameFromRepo(repo: string) {
  const slug = repo.split("/").pop()?.trim().toLowerCase();
  if (!slug) return null;

  const normalized = slug
    .replace(/\.git$/i, "")
    .replace(/[-_](service|svc|api|server|backend|frontend|web|app)$/i, "")
    .replace(/^(service|svc|api|server|backend|frontend|web|app)[-_]/i, "");

  if (!normalized) return null;
  if (normalized.endsWith("-svc") || normalized.endsWith("_svc")) return normalized;
  if (normalized.includes("payment")) return "payments-svc";
  if (normalized.includes("checkout")) return "checkout-svc";
  if (normalized.includes("order")) return "orders-svc";
  if (normalized.includes("auth")) return "auth-svc";

  return `${normalized.replace(/[-_]+/g, "-")}-svc`;
}
