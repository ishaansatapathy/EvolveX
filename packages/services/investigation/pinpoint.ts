import { fetchCommitChangedFiles, fetchRepoFileContent, githubBlobUrl, githubCommitUrl, isGithubApiConfigured } from "../github/api";
import { signozClient } from "../signoz/client";
import { parseStackLocations, pickBestStackLocation } from "./stack-trace";
import type { ChangeEventRowDto } from "./types";

export type PinpointLocation = {
  file: string;
  line: number;
  column?: number;
  confidence: "high" | "medium" | "low";
  source: "log_stack" | "github_diff" | "correlated";
  evidence: string;
  githubUrl?: string;
  repo?: string;
  commitSha?: string;
};

export type PinpointResult = {
  primary: PinpointLocation | null;
  candidates: PinpointLocation[];
  deployCorrelation: {
    repo: string;
    sha: string;
    message?: string;
    url: string;
    changedFiles: string[];
  } | null;
  githubApiConfigured: boolean;
};

function fileMatchesChanged(file: string, changedFiles: string[]): boolean {
  const normalized = file.replace(/\\/g, "/");
  return changedFiles.some(
    (changed) => normalized.endsWith(changed) || changed.endsWith(normalized) || normalized.includes(changed),
  );
}

export async function computeInvestigationPinpoint(input: {
  investigationId: string;
  service: string;
  startMs: number;
  endMs: number;
  changeEvents: ChangeEventRowDto[];
}): Promise<PinpointResult> {
  const [errorLogs, errorTraces] = await Promise.all([
    signozClient.searchLogs({
      serviceName: input.service,
      startMs: input.startMs,
      endMs: input.endMs,
      limit: 30,
    }),
    signozClient.searchErrorTraces({
      serviceName: input.service,
      startMs: input.startMs,
      endMs: input.endMs,
      limit: 10,
    }),
  ]);

  const errorLogBodies = errorLogs
    .filter((log) => /error|exception|panic|fatal|fail/i.test(log.severityText ?? "") || /error|exception|panic/i.test(log.body ?? ""))
    .map((log) => log.body ?? "")
    .filter(Boolean);

  const stackFromLogs = errorLogBodies.flatMap((body) => parseStackLocations(body));
  const bestFromLogs = pickBestStackLocation(stackFromLogs);

  const deployEvent = [...input.changeEvents]
    .reverse()
    .find((e) => e.type === "commit" || e.type === "deployment");

  let deployCorrelation: PinpointResult["deployCorrelation"] = null;
  let changedFiles: string[] = [];
  let repo: string | undefined;
  let sha: string | undefined;

  if (deployEvent) {
    repo = typeof deployEvent.metadata.repo === "string" ? deployEvent.metadata.repo : undefined;
    sha = typeof deployEvent.metadata.sha === "string" ? deployEvent.metadata.sha : undefined;
    const message = typeof deployEvent.metadata.message === "string" ? deployEvent.metadata.message : undefined;

    if (repo && sha && isGithubApiConfigured()) {
      const files = await fetchCommitChangedFiles(repo, sha);
      changedFiles = files.map((f) => f.filename);
      deployCorrelation = {
        repo,
        sha,
        message,
        url: githubCommitUrl(repo, sha),
        changedFiles,
      };
    } else if (repo && sha) {
      deployCorrelation = {
        repo,
        sha,
        message,
        url: githubCommitUrl(repo, sha),
        changedFiles: [],
      };
    }
  }

  const candidates: PinpointLocation[] = [];

  for (const loc of stackFromLogs.slice(0, 8)) {
    const matchedDeploy = changedFiles.length > 0 && fileMatchesChanged(loc.file, changedFiles);
    candidates.push({
      file: loc.file,
      line: loc.line,
      column: loc.column,
      confidence: matchedDeploy ? "high" : "medium",
      source: matchedDeploy ? "correlated" : "log_stack",
      evidence: matchedDeploy
        ? `Stack trace points here; file changed in deploy ${sha?.slice(0, 7)}`
        : `Parsed from error log stack trace`,
      githubUrl: repo && sha ? githubBlobUrl(repo, sha, loc.file, loc.line) : undefined,
      repo,
      commitSha: sha,
    });
  }

  let primary: PinpointLocation | null = null;

  if (bestFromLogs) {
    const matchedDeploy = changedFiles.length > 0 && fileMatchesChanged(bestFromLogs.file, changedFiles);
    primary = {
      file: bestFromLogs.file,
      line: bestFromLogs.line,
      column: bestFromLogs.column,
      confidence: matchedDeploy ? "high" : stackFromLogs.length > 0 ? "medium" : "low",
      source: matchedDeploy ? "correlated" : "log_stack",
      evidence: matchedDeploy
        ? `Error stack trace matches file changed in recent deploy (${repo}@${sha?.slice(0, 7)})`
        : `Strongest stack frame from SigNoz error logs (${errorLogBodies.length} error log(s) scanned)`,
      githubUrl: repo && sha ? githubBlobUrl(repo, sha, bestFromLogs.file, bestFromLogs.line) : undefined,
      repo,
      commitSha: sha,
    };
  } else if (changedFiles.length > 0) {
    const topFile = changedFiles[0]!;
    primary = {
      file: topFile,
      line: 1,
      confidence: "low",
      source: "github_diff",
      evidence: `No stack trace in logs; top file from deploy diff (${repo}@${sha?.slice(0, 7)})`,
      githubUrl: repo && sha ? githubBlobUrl(repo, sha, topFile) : undefined,
      repo,
      commitSha: sha,
    };
  } else if (errorTraces.length > 0) {
    const trace = errorTraces[0]!;
    primary = {
      file: trace.name ?? "unknown-span",
      line: 0,
      confidence: "low",
      source: "log_stack",
      evidence: `Error span "${trace.name}" (${trace.durationMs ?? "?"}ms) — no file:line in logs; inspect span in SigNoz`,
    };
  }

  return {
    primary,
    candidates,
    deployCorrelation,
    githubApiConfigured: isGithubApiConfigured(),
  };
}

export async function loadPinpointFileSnippet(input: {
  repo: string;
  ref: string;
  file: string;
  line: number;
  contextLines?: number;
}): Promise<string | null> {
  if (!isGithubApiConfigured()) return null;

  const content = await fetchRepoFileContent(input.repo, input.file, input.ref);
  if (!content) return null;

  const lines = content.split("\n");
  const idx = Math.max(0, input.line - 1);
  const radius = input.contextLines ?? 8;
  const start = Math.max(0, idx - radius);
  const end = Math.min(lines.length, idx + radius + 1);

  return lines
    .slice(start, end)
    .map((text, i) => {
      const lineNo = start + i + 1;
      const marker = lineNo === input.line ? ">" : " ";
      return `${marker} ${String(lineNo).padStart(4)} | ${text}`;
    })
    .join("\n");
}
