import { z } from "zod";

export const cicdStageEnum = [
  "build",
  "test",
  "docker",
  "release",
  "deploy",
  "rollback",
] as const;

export type CicdStage = (typeof cicdStageEnum)[number];

export type CicdStatus = "started" | "success" | "failure" | "cancelled" | "retried";

/** GitHub Actions / CircleCI / Jenkins / generic CI/CD webhook */
export const cicdEventSchema = z
  .object({
    provider: z.enum(["github_actions", "circleci", "jenkins", "gitlab", "generic"]).optional(),
    stage: z.string().optional(),
    status: z.string().optional(),
    conclusion: z.string().optional(),
    workflow: z.string().optional(),
    job: z.string().optional(),
    pipeline: z.string().optional(),
    runId: z.union([z.string(), z.number()]).optional(),
    runUrl: z.string().optional(),
    repository: z.union([
      z.string(),
      z.object({
        full_name: z.string().optional(),
        name: z.string().optional(),
      }),
    ]).optional(),
    repo: z.string().optional(),
    service: z.string().optional(),
    branch: z.string().optional(),
    commitSha: z.string().optional(),
    author: z.string().optional(),
    occurredAt: z.string().optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
    retried: z.boolean().optional(),
    attempt: z.number().optional(),
    /** GitHub Actions workflow_run */
    action: z.string().optional(),
    workflow_run: z
      .object({
        id: z.number().optional(),
        name: z.string().optional(),
        head_branch: z.string().optional(),
        head_sha: z.string().optional(),
        html_url: z.string().optional(),
        conclusion: z.string().optional(),
        status: z.string().optional(),
        created_at: z.string().optional(),
        updated_at: z.string().optional(),
        run_attempt: z.number().optional(),
        repository: z
          .object({
            full_name: z.string().optional(),
            name: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    /** GitHub Actions workflow_job */
    workflow_job: z
      .object({
        id: z.number().optional(),
        name: z.string().optional(),
        conclusion: z.string().optional(),
        status: z.string().optional(),
        html_url: z.string().optional(),
        started_at: z.string().optional(),
        completed_at: z.string().optional(),
        run_attempt: z.number().optional(),
        workflow_name: z.string().optional(),
      })
      .optional(),
    /** CircleCI */
    project: z
      .object({
        name: z.string().optional(),
        slug: z.string().optional(),
      })
      .optional(),
    /** Jenkins */
    build: z
      .object({
        full_url: z.string().optional(),
        number: z.number().optional(),
        phase: z.string().optional(),
        status: z.string().optional(),
        scm: z
          .object({
            branch: z.string().optional(),
            commit: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

export type CicdEventPayload = z.infer<typeof cicdEventSchema>;

function inferProvider(payload: CicdEventPayload): string {
  if (payload.provider) return payload.provider;
  if (payload.workflow_run || payload.workflow_job) return "github_actions";
  if (payload.project?.slug) return "circleci";
  if (payload.build) return "jenkins";
  return "generic";
}

function inferStage(payload: CicdEventPayload, jobName: string): CicdStage {
  const explicit = payload.stage?.toLowerCase();
  if (explicit && cicdStageEnum.includes(explicit as CicdStage)) {
    return explicit as CicdStage;
  }

  const blob = [jobName, payload.workflow, payload.pipeline, payload.action].filter(Boolean).join(" ").toLowerCase();

  if (/rollback|revert|roll.?back/.test(blob)) return "rollback";
  if (/deploy|release|prod|production|helm|k8s|kubectl/.test(blob)) return "deploy";
  if (/docker|image|container|buildx|ecr|gcr/.test(blob)) return "docker";
  if (/release|tag|publish|artifact/.test(blob)) return "release";
  if (/test|lint|unit|integration|e2e|pytest|jest|vitest/.test(blob)) return "test";
  return "build";
}

function inferStatus(payload: CicdEventPayload): CicdStatus {
  const blob = [
    payload.status,
    payload.conclusion,
    payload.workflow_run?.conclusion,
    payload.workflow_run?.status,
    payload.workflow_job?.conclusion,
    payload.workflow_job?.status,
    payload.build?.status,
    payload.build?.phase,
    payload.action,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (payload.retried || (payload.attempt ?? 0) > 1 || /retr/i.test(blob)) return "retried";
  if (/fail|error|timed.?out|timeout|broken|unstable/.test(blob)) return "failure";
  if (/cancel|abort|skip/.test(blob)) return "cancelled";
  if (/success|passed|complete|finished|fixed/.test(blob)) return "success";
  if (/start|queued|in.?progress|running|pending|requested/.test(blob)) return "started";
  return "success";
}

function inferRepository(payload: CicdEventPayload): string {
  const repoField = payload.repository;
  if (typeof repoField === "object" && repoField !== null) {
    return repoField.full_name ?? repoField.name ?? "unknown-repo";
  }

  return (
    (typeof repoField === "string" ? repoField : undefined) ??
    payload.repo ??
    payload.workflow_run?.repository?.full_name ??
    payload.workflow_run?.repository?.name ??
    payload.project?.slug ??
    payload.project?.name ??
    "unknown-repo"
  );
}

function inferJobName(payload: CicdEventPayload): string {
  return (
    payload.job ??
    payload.workflow_job?.name ??
    payload.workflow_run?.name ??
    payload.workflow ??
    payload.pipeline ??
    payload.build?.phase ??
    "pipeline"
  );
}

function inferService(payload: CicdEventPayload, repository: string): string {
  if (payload.service?.trim()) return payload.service.trim();

  const repoName = repository.split("/").pop() ?? repository;
  const normalized = repoName.replace(/[-_]+/g, "-");
  if (/payment|checkout|order|cart/i.test(normalized)) return "payments-svc";
  return normalized.replace(/-service$|-svc$|-api$/, "") || normalized;
}

function inferOccurredAt(payload: CicdEventPayload): Date {
  const raw =
    payload.occurredAt ??
    payload.timestamp ??
    payload.workflow_job?.completed_at ??
    payload.workflow_job?.started_at ??
    payload.workflow_run?.updated_at ??
    payload.workflow_run?.created_at;

  if (typeof raw === "number") {
    const ms = raw > 1_000_000_000_000 ? raw : raw * 1000;
    return new Date(ms);
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function inferRunUrl(payload: CicdEventPayload): string | undefined {
  return (
    payload.runUrl ??
    payload.workflow_run?.html_url ??
    payload.workflow_job?.html_url ??
    payload.build?.full_url
  );
}

function inferRunId(payload: CicdEventPayload): string | undefined {
  const raw =
    payload.runId ??
    payload.workflow_run?.id ??
    payload.workflow_job?.id ??
    payload.build?.number;
  return raw == null ? undefined : String(raw);
}

export function classifyCicdSeverity(stage: CicdStage, status: CicdStatus): "critical" | "warning" | "info" {
  if (status === "failure" && (stage === "test" || stage === "build" || stage === "deploy")) {
    return "critical";
  }
  if (status === "retried" || status === "failure") return "warning";
  if (stage === "deploy" || stage === "rollback") return "warning";
  return "info";
}

export function parseCicdEvent(payload: CicdEventPayload) {
  const provider = inferProvider(payload);
  const jobName = inferJobName(payload);
  const stage = inferStage(payload, jobName);
  const status = inferStatus(payload);
  const repository = inferRepository(payload);
  const service = inferService(payload, repository);
  const occurredAt = inferOccurredAt(payload);
  const runUrl = inferRunUrl(payload);
  const runId = inferRunId(payload);
  const branch =
    payload.branch ??
    payload.workflow_run?.head_branch ??
    payload.build?.scm?.branch ??
    "main";
  const commitSha =
    payload.commitSha ??
    payload.workflow_run?.head_sha ??
    payload.build?.scm?.commit;
  const attempt = payload.attempt ?? payload.workflow_run?.run_attempt ?? payload.workflow_job?.run_attempt ?? 1;
  const severity = classifyCicdSeverity(stage, status);

  const statusLabel =
    status === "failure"
      ? "failed"
      : status === "retried"
        ? "retried"
        : status === "cancelled"
          ? "cancelled"
          : status === "started"
            ? "started"
            : "passed";

  const title =
    severity === "critical"
      ? `CI/CD · ${stage} ${statusLabel}`
      : `CI/CD: ${jobName} ${statusLabel}`;

  const detail = `[${provider}] ${repository} · ${stage} ${statusLabel}${branch ? ` (${branch})` : ""}${
    attempt > 1 ? ` · attempt ${attempt}` : ""
  }`;

  const fingerprint = `${provider}|${repository}|${stage}|${runId ?? jobName}|${status}|${attempt}`.toLowerCase();

  return {
    provider,
    stage,
    status,
    jobName,
    repository,
    service,
    branch,
    commitSha,
    author: payload.author,
    occurredAt,
    runUrl,
    runId,
    attempt,
    severity,
    title,
    detail,
    fingerprint,
    timelineKind: stage === "deploy" || stage === "release" ? ("DEPLOY" as const) : ("CHANGE" as const),
  };
}
