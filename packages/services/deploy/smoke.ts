export type DeployCheckResult = {
  name: string;
  ok: boolean;
  status: number | null;
  message: string;
  durationMs: number;
};

export type DeploySmokeResult = {
  baseUrl: string;
  ok: boolean;
  checks: DeployCheckResult[];
  summary: string;
};

async function runCheck(name: string, url: string, validate: (response: Response, body: unknown) => string | null) {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => null)) as unknown;
    const error = validate(response, body);
    return {
      name,
      ok: response.ok && !error,
      status: response.status,
      message: error ?? "ok",
      durationMs: Math.round((Date.now() - start) * 10) / 10,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: null,
      message: error instanceof Error ? error.message : "request failed",
      durationMs: Math.round((Date.now() - start) * 10) / 10,
    };
  }
}

/** Feature #45 — post-deploy smoke checks against a live API base URL. */
export async function runDeploySmoke(baseUrl: string): Promise<DeploySmokeResult> {
  const normalized = baseUrl.trim().replace(/\/+$/, "");

  const checks = await Promise.all([
    runCheck("health", `${normalized}/health`, (response, body) => {
      if (!response.ok) return `HTTP ${response.status}`;
      const record = body as { healthy?: boolean; database?: string } | null;
      if (!record?.healthy) return "healthy=false";
      if (record.database && record.database !== "ok") return `database=${record.database}`;
      return null;
    }),
    runCheck("health_deep", `${normalized}/health/deep`, (response, body) => {
      if (response.status === 503) {
        const record = body as { healthy?: boolean } | null;
        return record?.healthy === false ? "dependency checks failed" : `HTTP 503`;
      }
      if (!response.ok) return `HTTP ${response.status}`;
      const record = body as { healthy?: boolean } | null;
      return record?.healthy ? null : "healthy=false";
    }),
    runCheck("openapi", `${normalized}/openapi.json`, (response) =>
      response.ok ? null : `HTTP ${response.status}`,
    ),
    runCheck("kubernetes_webhook", `${normalized}/webhooks/kubernetes`, (response, body) => {
      if (!response.ok) return `HTTP ${response.status}`;
      const record = body as { ok?: boolean } | null;
      return record?.ok ? null : "ok flag missing";
    }),
    runCheck("signoz_webhook", `${normalized}/webhooks/signoz`, (response) =>
      response.status === 405 || response.status === 400 || response.ok
        ? null
        : `unexpected HTTP ${response.status}`,
    ),
  ]);

  const ok = checks.every((check) => check.ok);
  const failed = checks.filter((check) => !check.ok).map((check) => check.name);

  return {
    baseUrl: normalized,
    ok,
    checks,
    summary: ok
      ? `All ${checks.length} deploy smoke checks passed`
      : `Failed checks: ${failed.join(", ")}`,
  };
}
