import {
  probeDatabaseConnection,
  probeGithubApiConnection,
  probeOpenAiConnection,
  probeSignozConnection,
} from "../integrations/probes";
import { isSignozWebhookConfigured } from "../integrations/config";

export type DeepHealthCheckItem = {
  id: string;
  label: string;
  ok: boolean;
  message: string;
};

export type DeepHealthSnapshot = {
  generatedAt: string;
  healthy: boolean;
  environment: string;
  checks: DeepHealthCheckItem[];
};

/** Feature #37 — deep health checks beyond liveness (DB, SigNoz, GitHub, OpenAI). */
export async function buildDeepHealthSnapshot(): Promise<DeepHealthSnapshot> {
  const [database, signoz, github, openai] = await Promise.all([
    probeDatabaseConnection(),
    probeSignozConnection(),
    probeGithubApiConnection(),
    probeOpenAiConnection(),
  ]);

  const checks: DeepHealthCheckItem[] = [
    { id: "database", label: "Database", ok: database.ok, message: database.message },
    { id: "signoz_api", label: "SigNoz API", ok: signoz.ok, message: signoz.message },
    {
      id: "signoz_webhook",
      label: "SigNoz webhook secret",
      ok: isSignozWebhookConfigured(),
      message: isSignozWebhookConfigured()
        ? "SIGNOZ_WEBHOOK_SECRET configured"
        : "SIGNOZ_WEBHOOK_SECRET not set",
    },
    { id: "github_api", label: "GitHub API", ok: github.ok, message: github.message },
    { id: "openai", label: "OpenAI", ok: openai.ok, message: openai.message },
  ];

  const requiredOk = checks.filter((check) => check.id === "database").every((check) => check.ok);

  return {
    generatedAt: new Date().toISOString(),
    healthy: requiredOk,
    environment: process.env.NODE_ENV ?? "development",
    checks,
  };
}
