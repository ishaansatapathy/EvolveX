import { validateDeployEnvironment, type DeployPreflightResult } from "./preflight";
import { runDeploySmoke, type DeploySmokeResult } from "./smoke";

export type DeployCheckResult = {
  generatedAt: string;
  ok: boolean;
  preflight: DeployPreflightResult;
  smoke: DeploySmokeResult | null;
  summary: string;
};

/** Feature #45 — preflight + optional post-deploy smoke in one command. */
export async function runDeployCheck(input?: {
  environment?: "development" | "staging" | "production";
  baseUrl?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<DeployCheckResult> {
  const preflight = validateDeployEnvironment({
    environment: input?.environment,
    env: input?.env,
  });

  const baseUrl =
    input?.baseUrl === undefined
      ? process.env.BASE_URL?.trim() || null
      : input.baseUrl?.trim() || null;
  const smoke = baseUrl ? await runDeploySmoke(baseUrl) : null;

  const ok = preflight.ok && (smoke?.ok ?? true);
  const summary = !preflight.ok
    ? preflight.summary
    : smoke && !smoke.ok
      ? smoke.summary
      : smoke
        ? `${preflight.summary}; ${smoke.summary}`
        : preflight.summary;

  return {
    generatedAt: new Date().toISOString(),
    ok,
    preflight,
    smoke,
    summary,
  };
}
