import { isOpenAiConfigured } from "../ai/openai";
import { isGithubApiConfigured } from "../github/api";
import { isSlackConfigured } from "./slack";
import { isPagerDutyConfigured } from "./pagerduty";
import {
  getDefaultServiceName,
  getSignozConfig,
  getSignozWebhookPublicUrl,
  isProductionEnvironment,
  isSignozConfigured,
} from "../signoz-env";
import {
  getIntegrationBaseUrl,
  isDatabaseConfigured,
  isEbpfWebhookConfigured,
  isGithubWebhookConfigured,
  isKubernetesWebhookConfigured,
  isSignozIngestionConfigured,
  isSignozWebhookConfigured,
} from "./config";

export type IntegrationHealthStatus = "ready" | "partial" | "missing" | "unavailable";

export type IntegrationHealthItem = {
  id: string;
  label: string;
  category: "telemetry" | "ai" | "change" | "platform";
  status: IntegrationHealthStatus;
  configured: boolean;
  authConfigured: boolean;
  connected: boolean | null;
  detail: string;
  webhookUrl: string | null;
  actionLabel: string | null;
};

export type IntegrationHealthResult = {
  readyCount: number;
  partialCount: number;
  missingCount: number;
  totalCount: number;
  summary: string;
  productionMode: boolean;
  baseUrl: string;
  cloudUrl: string | null;
  defaultServiceName: string;
  integrations: IntegrationHealthItem[];
};

function deriveStatus(input: {
  configured: boolean;
  authConfigured: boolean;
  connected?: boolean | null;
}): IntegrationHealthStatus {
  if (!input.configured) return "missing";
  if (input.connected === false) return "partial";
  if (!input.authConfigured) return "partial";
  if (input.connected === true || input.authConfigured) return "ready";
  return "partial";
}

function buildItem(input: Omit<IntegrationHealthItem, "status">): IntegrationHealthItem {
  return {
    ...input,
    status: deriveStatus({
      configured: input.configured,
      authConfigured: input.authConfigured,
      connected: input.connected,
    }),
  };
}

/** Workspace-level integration readiness — env config + optional org overrides. */
export function buildIntegrationHealth(input?: {
  databaseConnected?: boolean | null;
  orgSignozConfigured?: boolean;
  orgGithubConfigured?: boolean;
  orgGithubWebhookConfigured?: boolean;
  orgSlackConfigured?: boolean;
  orgPagerDutyConfigured?: boolean;
  orgSource?: "organization" | "environment";
}): IntegrationHealthResult {
  const orgSource = input?.orgSource ?? "environment";
  const signozReady = input?.orgSignozConfigured ?? isSignozConfigured();
  const githubReady = input?.orgGithubConfigured ?? isGithubApiConfigured();
  const githubWebhookReady = input?.orgGithubWebhookConfigured ?? isGithubWebhookConfigured();
  const slackReady = input?.orgSlackConfigured ?? isSlackConfigured();
  const pagerDutyReady = input?.orgPagerDutyConfigured ?? isPagerDutyConfigured();
  const sourceLabel = orgSource === "organization" ? "workspace vault" : ".env";
  const baseUrl = getIntegrationBaseUrl();
  const signozConfig = getSignozConfig();
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const isNeon = databaseUrl.includes("neon.tech");
  const databaseConnected = input?.databaseConnected ?? null;

  const integrations: IntegrationHealthItem[] = [
    buildItem({
      id: "signoz_api",
      label: "SigNoz API",
      category: "telemetry",
      configured: signozReady,
      authConfigured: signozReady,
      connected: null,
      detail: signozReady
        ? signozConfig?.cloudUrl
          ? `Cloud URL ${signozConfig.cloudUrl} · ${sourceLabel}`
          : `Configured via ${sourceLabel}`
        : "Connect SigNoz in workspace settings or set SIGNOZ_CLOUD_URL + SIGNOZ_API_KEY",
      webhookUrl: null,
      actionLabel: "Test SigNoz API",
    }),
    buildItem({
      id: "signoz_webhook",
      label: "SigNoz alerts",
      category: "telemetry",
      configured: signozReady,
      authConfigured: isSignozWebhookConfigured(),
      connected: null,
      detail: isSignozWebhookConfigured()
        ? "Webhook secret configured — alerts can open investigations"
        : "Set SIGNOZ_WEBHOOK_SECRET and expose POST /webhooks/signoz",
      webhookUrl: getSignozWebhookPublicUrl(baseUrl),
      actionLabel: "Copy alert webhook",
    }),
    buildItem({
      id: "signoz_ingestion",
      label: "OTel ingestion",
      category: "telemetry",
      configured: isSignozIngestionConfigured(),
      authConfigured: isSignozIngestionConfigured(),
      connected: null,
      detail: isSignozIngestionConfigured()
        ? "evolvex-api + evolvex-web can emit traces to SigNoz"
        : "Set SIGNOZ_INGESTION_KEY for self-instrumentation",
      webhookUrl: null,
      actionLabel: null,
    }),
    buildItem({
      id: "openai",
      label: "OpenAI",
      category: "ai",
      configured: isOpenAiConfigured(),
      authConfigured: isOpenAiConfigured(),
      connected: null,
      detail: isOpenAiConfigured()
        ? "LLM summaries generated from real evidence only"
        : "Set OPENAI_API_KEY for AI root-cause summaries",
      webhookUrl: null,
      actionLabel: "Test OpenAI",
    }),
    buildItem({
      id: "slack",
      label: "Slack notifications",
      category: "platform",
      configured: slackReady,
      authConfigured: slackReady,
      connected: null,
      detail: slackReady
        ? `Investigation ready + case resolved alerts post to Slack · ${sourceLabel}`
        : "Connect Slack in workspace settings or set SLACK_WEBHOOK_URL",
      webhookUrl: null,
      actionLabel: null,
    }),
    buildItem({
      id: "pagerduty",
      label: "PagerDuty",
      category: "platform",
      configured: pagerDutyReady,
      authConfigured: pagerDutyReady,
      connected: null,
      detail: pagerDutyReady
        ? `Events API v2 triggers + resolves incidents · ${sourceLabel}`
        : "Connect PagerDuty in workspace settings or set PAGERDUTY_ROUTING_KEY",
      webhookUrl: null,
      actionLabel: null,
    }),
    buildItem({
      id: "github_api",
      label: "GitHub API",
      category: "change",
      configured: githubReady,
      authConfigured: githubReady,
      connected: null,
      detail: githubReady
        ? `Pinpoint file fetch + deploy diff correlation enabled · ${sourceLabel}`
        : "Connect GitHub in workspace settings or set GITHUB_TOKEN",
      webhookUrl: null,
      actionLabel: "Test GitHub token",
    }),
    buildItem({
      id: "github_webhook",
      label: "GitHub deploys",
      category: "change",
      configured: true,
      authConfigured: githubWebhookReady,
      connected: null,
      detail: githubWebhookReady
        ? `Push webhook verified via X-Hub-Signature-256 · ${sourceLabel}`
        : "Add webhook secret in GitHub settings below (or set GITHUB_WEBHOOK_SECRET in .env)",
      webhookUrl: `${baseUrl}/webhooks/github`,
      actionLabel: "Copy GitHub webhook",
    }),
    buildItem({
      id: "kubernetes_webhook",
      label: "Kubernetes",
      category: "change",
      configured: true,
      authConfigured: isKubernetesWebhookConfigured(),
      connected: null,
      detail: isKubernetesWebhookConfigured()
        ? "Cluster change events can correlate to investigations"
        : "Set KUBERNETES_WEBHOOK_SECRET for secured cluster events",
      webhookUrl: `${baseUrl}/webhooks/kubernetes`,
      actionLabel: "Copy K8s webhook",
    }),
    buildItem({
      id: "ebpf_webhook",
      label: "eBPF webhook",
      category: "telemetry",
      configured: true,
      authConfigured: isEbpfWebhookConfigured(),
      connected: null,
      detail: isEbpfWebhookConfigured()
        ? "Direct kernel/agent webhook path configured"
        : "Optional — set EBPF_WEBHOOK_SECRET for Cilium/Pixie-style events",
      webhookUrl: `${baseUrl}/webhooks/ebpf`,
      actionLabel: "Copy eBPF webhook",
    }),
    buildItem({
      id: "obi",
      label: "OBI → SigNoz",
      category: "telemetry",
      configured: isSignozIngestionConfigured() || isSignozConfigured(),
      authConfigured: isSignozIngestionConfigured(),
      connected: null,
      detail: isSignozIngestionConfigured()
        ? "Run pnpm obi:up — OBI exports metrics/traces via SigNoz OTLP"
        : "Requires SigNoz ingestion key; see docs/EBPF-OBI.md",
      webhookUrl: null,
      actionLabel: null,
    }),
    buildItem({
      id: "database",
      label: "Database",
      category: "platform",
      configured: isDatabaseConfigured(),
      authConfigured: isDatabaseConfigured(),
      connected: databaseConnected,
      detail: !isDatabaseConfigured()
        ? "Set DATABASE_URL (Neon recommended)"
        : databaseConnected === true
          ? isNeon
            ? "Neon Postgres connected"
            : "Postgres connected"
          : databaseConnected === false
            ? "DATABASE_URL set but connection failed"
            : isNeon
              ? "Neon URL configured"
              : "Postgres URL configured",
      webhookUrl: null,
      actionLabel: "Test database",
    }),
  ];

  const readyCount = integrations.filter((item) => item.status === "ready").length;
  const partialCount = integrations.filter((item) => item.status === "partial").length;
  const missingCount = integrations.filter((item) => item.status === "missing").length;

  let summary = `${readyCount}/${integrations.length} integrations ready`;
  if (partialCount > 0) summary += ` · ${partialCount} need attention`;
  if (missingCount > 0 && readyCount === 0) summary = "Connect SigNoz to start investigations";

  return {
    readyCount,
    partialCount,
    missingCount,
    totalCount: integrations.length,
    summary,
    productionMode: isProductionEnvironment(),
    baseUrl,
    cloudUrl: signozConfig?.cloudUrl ?? null,
    defaultServiceName: getDefaultServiceName(),
    integrations,
  };
}
