import { eq } from "@repo/database";
import { db } from "@repo/database";
import {
  investigationTimelineEntriesTable,
  investigationsTable,
  type SelectInvestigation,
} from "@repo/database/schema";

import { fetchCommitChangedFiles, githubCommitUrl, isGithubApiConfigured } from "../github/api";
import {
  inferServiceNameFromRepo,
  parseGithubDeployEvent,
  type GithubPushPayload,
} from "../github/webhook-parser";
import { resolveGithubToken } from "../organization/integrations";
import { isSignozConfigured } from "../signoz-env";
import type { InvestigationContext } from "./types";
import { insertTimelineEntry, persistChangeEvent } from "./persistence";
import { invalidatePipelineCache } from "./pipeline-cache";

export type GithubDeployEvent = ReturnType<typeof parseGithubDeployEvent>;

export type GithubDeployCorrelationResult = {
  attachedInvestigationIds: string[];
  skippedDuplicate: string[];
  refreshedInvestigationIds: string[];
  matchedBy: "time_window" | "service_match" | "fallback_recent";
};

const DEFAULT_WINDOW_BEFORE_MS = 45 * 60 * 1000;
const DEFAULT_WINDOW_AFTER_MS = 20 * 60 * 1000;
import { loadRecentInvestigationCandidates } from "./investigation-candidates";

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/[-_]+/g, "");
}

function serviceNameMatchesRepo(service: string, repo: string) {
  const inferred = inferServiceNameFromRepo(repo);
  if (!inferred) return false;

  const serviceToken = normalizeToken(service);
  const inferredToken = normalizeToken(inferred);
  const repoToken = normalizeToken(repo.split("/").pop() ?? repo);

  return (
    serviceToken === inferredToken ||
    serviceToken.includes(inferredToken) ||
    inferredToken.includes(serviceToken) ||
    serviceToken.includes(repoToken) ||
    repoToken.includes(serviceToken)
  );
}

function serviceMatchesRepo(row: SelectInvestigation, repo: string) {
  for (const service of [row.primaryService, ...(row.affectedServices ?? [])]) {
    if (service && serviceNameMatchesRepo(service, repo)) return true;
  }
  return false;
}

export function scoreGithubDeployMatch(
  row: SelectInvestigation,
  deploy: GithubDeployEvent,
  windowBeforeMs = DEFAULT_WINDOW_BEFORE_MS,
  windowAfterMs = DEFAULT_WINDOW_AFTER_MS,
) {
  let score = 0;
  const reasons: string[] = [];

  const anchor = row.incidentWindowStart?.getTime() ?? row.createdAt.getTime();
  const deployMs = deploy.occurredAt.getTime();
  const inWindow = deployMs >= anchor - windowBeforeMs && deployMs <= anchor + windowAfterMs;

  if (inWindow) {
    score += 50;
    reasons.push("Deploy within incident window");
  }

  if (serviceMatchesRepo(row, deploy.repo)) {
    score += 35;
    reasons.push(`Repo maps to affected service (${deploy.repo})`);
  }

  if (row.caseStatus !== "resolved") {
    score += 15;
    reasons.push("Open investigation");
  } else {
    score += 5;
  }

  if (row.status === "ready") {
    score += 5;
  }

  return { score, inWindow, reasons };
}

export function selectGithubDeployTargets(
  candidates: SelectInvestigation[],
  deploy: GithubDeployEvent,
): Array<{ row: SelectInvestigation; score: number; reasons: string[]; matchedBy: GithubDeployCorrelationResult["matchedBy"] }> {
  const scored = candidates
    .map((row) => {
      const result = scoreGithubDeployMatch(row, deploy);
      return { row, ...result };
    })
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score);

  const inWindow = scored.filter((item) => item.inWindow);
  if (inWindow.length > 0) {
    return inWindow.map((item) => ({
      row: item.row,
      score: item.score,
      reasons: item.reasons,
      matchedBy: serviceMatchesRepo(item.row, deploy.repo) ? "service_match" : "time_window",
    }));
  }

  const serviceMatches = scored.filter((item) => serviceMatchesRepo(item.row, deploy.repo));
  if (serviceMatches.length > 0) {
    return serviceMatches.map((item) => ({
      row: item.row,
      score: item.score,
      reasons: item.reasons,
      matchedBy: "service_match" as const,
    }));
  }

  const recentOpen = candidates.find((row) => row.caseStatus !== "resolved");
  if (recentOpen) {
    const result = scoreGithubDeployMatch(recentOpen, deploy);
    return [
      {
        row: recentOpen,
        score: result.score,
        reasons: [...result.reasons, "Fallback: most recent open investigation"],
        matchedBy: "fallback_recent",
      },
    ];
  }

  if (candidates[0]) {
    const result = scoreGithubDeployMatch(candidates[0], deploy);
    return [
      {
        row: candidates[0],
        score: result.score,
        reasons: [...result.reasons, "Fallback: most recent investigation"],
        matchedBy: "fallback_recent",
      },
    ];
  }

  return [];
}

export function buildGithubDeployDetail(
  deploy: GithubDeployEvent,
  changedFiles: string[],
) {
  const base = deploy.detail;
  if (changedFiles.length === 0) return base;

  const preview = changedFiles.slice(0, 5).join(", ");
  const suffix = changedFiles.length > 5 ? ` (+${changedFiles.length - 5} more)` : "";
  return `${base}\nChanged files: ${preview}${suffix}`;
}

function deployAlreadyAttached(
  timelineRows: Array<{ kind: string; sourceRef: unknown; metadata: unknown }>,
  fullSha: string,
  shortSha: string,
) {
  return timelineRows.some((entry) => {
    if (entry.kind !== "DEPLOY") return false;
    const sourceRef = (entry.sourceRef ?? {}) as Record<string, unknown>;
    const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
    const sha = typeof sourceRef.sha === "string" ? sourceRef.sha : typeof metadata.sha === "string" ? metadata.sha : null;
    if (!sha) return false;
    return sha === fullSha || sha === shortSha || fullSha.startsWith(sha) || sha.startsWith(fullSha.slice(0, 7));
  });
}

export async function loadGithubDeployCandidates(input: {
  organizationId?: string | null;
  ownerUserId?: string | null;
  since?: Date;
}) {
  return loadRecentInvestigationCandidates(input);
}

export async function correlateGithubDeployPush(input: {
  payload: GithubPushPayload;
  organizationId?: string | null;
  ownerUserId?: string | null;
  refreshPipeline?: (investigationId: string) => Promise<void>;
}): Promise<GithubDeployCorrelationResult> {
  const deploy = parseGithubDeployEvent(input.payload);
  const candidates = await loadGithubDeployCandidates({
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
  });

  const targets = selectGithubDeployTargets(candidates, deploy);
  const attachedInvestigationIds: string[] = [];
  const skippedDuplicate: string[] = [];
  const refreshedInvestigationIds: string[] = [];

  let changedFiles: string[] = [];
  const githubToken = await resolveGithubToken(input.organizationId);
  if (isGithubApiConfigured(githubToken) && deploy.fullSha !== "unknown") {
    const files = await fetchCommitChangedFiles(deploy.repo, deploy.fullSha, githubToken);
    changedFiles = files.map((file) => file.filename);
  }

  const detail = buildGithubDeployDetail(deploy, changedFiles);
  const commitUrl = deploy.fullSha !== "unknown" ? githubCommitUrl(deploy.repo, deploy.fullSha) : null;

  for (const target of targets) {
    const row = target.row;
    const timelineRows = await db
      .select()
      .from(investigationTimelineEntriesTable)
      .where(eq(investigationTimelineEntriesTable.investigationId, row.id));

    if (deployAlreadyAttached(timelineRows, deploy.fullSha, deploy.sha)) {
      skippedDuplicate.push(row.id);
      continue;
    }

    const maxSort = timelineRows.reduce((max, entry) => Math.max(max, entry.sortOrder ?? 0), 0);
    const correlatedService =
      row.primaryService ??
      row.affectedServices.find((service) => serviceNameMatchesRepo(service, deploy.repo)) ??
      inferServiceNameFromRepo(deploy.repo) ??
      row.affectedServices[0] ??
      deploy.repo;

    await insertTimelineEntry({
      investigationId: row.id,
      occurredAt: deploy.occurredAt,
      kind: "DEPLOY",
      title: deploy.title,
      detail,
      source: "github-webhook",
      sourceRef: {
        repo: deploy.repo,
        branch: deploy.branch,
        sha: deploy.fullSha,
        shaShort: deploy.sha,
        author: deploy.author,
        commitUrl,
        correlationScore: target.score,
        matchReasons: target.reasons,
        matchedBy: target.matchedBy,
        changedFiles,
      },
      sortOrder: maxSort + 1,
      metadata: {
        repo: deploy.repo,
        sha: deploy.fullSha,
        shaShort: deploy.sha,
        branch: deploy.branch,
        changedFiles,
        correlatedService,
        correlationScore: target.score,
        matchedBy: target.matchedBy,
      },
    });

    await persistChangeEvent({
      investigationId: row.id,
      type: "commit",
      service: correlatedService,
      author: deploy.author,
      occurredAt: deploy.occurredAt,
      metadata: {
        repo: deploy.repo,
        branch: deploy.branch,
        sha: deploy.fullSha,
        shaShort: deploy.sha,
        message: deploy.message,
        changedFiles,
        commitUrl,
        correlationScore: target.score,
        matchedBy: target.matchedBy,
      },
    });

    const context = (row.investigationContext as InvestigationContext | null) ?? {
      summary: row.title,
      evidence: [],
      affectedServices: row.affectedServices ?? [],
      incidentWindow: {
        start: row.incidentWindowStart?.toISOString() ?? new Date().toISOString(),
        end: row.incidentWindowEnd?.toISOString() ?? new Date().toISOString(),
      },
      signozConfigured: isSignozConfigured(),
      notes: [],
    };

    context.evidence.push({
      id: `deploy-${deploy.fullSha}`,
      kind: "DEPLOY",
      title: deploy.title,
      detail,
      occurredAt: deploy.occurredAt.toISOString(),
      source: "github-webhook",
    });

    const fileNote =
      changedFiles.length > 0
        ? `GitHub diff fetched (${changedFiles.length} files) for pinpoint correlation.`
        : "Deploy correlated from GitHub push webhook.";
    context.notes = [...(context.notes ?? []), fileNote];

    await db
      .update(investigationsTable)
      .set({ investigationContext: context, updatedAt: new Date() })
      .where(eq(investigationsTable.id, row.id));

    await invalidatePipelineCache(row.id);
    attachedInvestigationIds.push(row.id);

    if (input.refreshPipeline) {
      await input.refreshPipeline(row.id);
      refreshedInvestigationIds.push(row.id);
    }
  }

  return {
    attachedInvestigationIds,
    skippedDuplicate,
    refreshedInvestigationIds,
    matchedBy: targets[0]?.matchedBy ?? "fallback_recent",
  };
}
