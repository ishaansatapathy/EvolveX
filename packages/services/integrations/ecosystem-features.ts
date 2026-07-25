import { isSlackConfigured } from "./slack";
import { isPagerDutyConfigured } from "./pagerduty";
import {
  isCicdWebhookConfigured,
  isEbpfWebhookConfigured,
  isFeatureFlagWebhookConfigured,
  isGithubWebhookConfigured,
  isJiraConfigured,
  isKubernetesWebhookConfigured,
  isSdkApiConfigured,
} from "./config";
import { isGithubApiConfigured } from "../github/api";

export type EcosystemFeatureStatus = {
  id: string;
  label: string;
  status: "active" | "partial" | "optional";
  detail: string;
};

/** Feature map for Part 6 (#46–#60) integration & DX capabilities. */
export function buildIntegrationsEcosystemFeatures(input?: {
  orgSlackConfigured?: boolean;
  orgPagerDutyConfigured?: boolean;
  orgJiraConfigured?: boolean;
  orgGithubConfigured?: boolean;
  orgGithubWebhookConfigured?: boolean;
  orgKubernetesConfigured?: boolean;
}): EcosystemFeatureStatus[] {
  const slackReady = input?.orgSlackConfigured ?? isSlackConfigured();
  const pagerDutyReady = input?.orgPagerDutyConfigured ?? isPagerDutyConfigured();
  const jiraReady = input?.orgJiraConfigured ?? isJiraConfigured();
  const githubApiReady = input?.orgGithubConfigured ?? isGithubApiConfigured();
  const githubWebhookReady = input?.orgGithubWebhookConfigured ?? isGithubWebhookConfigured();
  const kubernetesReady = input?.orgKubernetesConfigured ?? isKubernetesWebhookConfigured();

  return [
    {
      id: "#46",
      label: "Slack integration",
      status: slackReady ? "active" : "optional",
      detail: slackReady ? "Webhook configured" : "Set SLACK_WEBHOOK_URL or workspace vault",
    },
    {
      id: "#47",
      label: "PagerDuty integration",
      status: pagerDutyReady ? "active" : "optional",
      detail: pagerDutyReady ? "Routing key configured" : "Set PAGERDUTY_ROUTING_KEY",
    },
    {
      id: "#48",
      label: "Jira integration",
      status: jiraReady ? "active" : "optional",
      detail: jiraReady ? "Issue creation enabled" : "Connect Jira in Settings",
    },
    {
      id: "#49",
      label: "GitHub deploy correlation",
      status: githubWebhookReady && githubApiReady ? "active" : githubWebhookReady || githubApiReady ? "partial" : "optional",
      detail:
        githubWebhookReady && githubApiReady
          ? "Webhook + PAT — deploy timeline + rollback links"
          : githubWebhookReady
            ? "Webhook active — add PAT for pinpoint/diff"
            : githubApiReady
              ? "PAT active — register deploy webhook"
              : "Connect GitHub in Settings",
    },
    {
      id: "#50",
      label: "Kubernetes event correlation",
      status: kubernetesReady ? "active" : "optional",
      detail: kubernetesReady ? "K8s webhook configured" : "Run Helm onboarding in Settings",
    },
    {
      id: "#51",
      label: "eBPF / OBI integration",
      status: isEbpfWebhookConfigured() ? "active" : "optional",
      detail: isEbpfWebhookConfigured()
        ? "OBI webhook active (env fallback)"
        : "Connect per-workspace in Settings, or set EBPF_WEBHOOK_SECRET",
    },
    {
      id: "#52",
      label: "Feature flag correlation",
      status: isFeatureFlagWebhookConfigured() ? "active" : "optional",
      detail: isFeatureFlagWebhookConfigured()
        ? "Feature flag webhook active (env fallback)"
        : "Connect per-workspace in Settings, or set FEATURE_FLAG_WEBHOOK_SECRET",
    },
    {
      id: "#53",
      label: "CI/CD correlation",
      status: isCicdWebhookConfigured() ? "active" : "optional",
      detail: isCicdWebhookConfigured()
        ? "CI/CD webhook active (env fallback)"
        : "Connect per-workspace in Settings, or set CICD_WEBHOOK_SECRET",
    },
    { id: "#54", label: "Timeline UX improvements", status: "active", detail: "Grouping, filters, search" },
    { id: "#55", label: "Telemetry intelligence dashboard", status: "active", detail: "Dashboards page" },
    { id: "#56", label: "Interactive architecture view", status: "active", detail: "Service map panel" },
    {
      id: "#57",
      label: "SDK for custom integrations",
      status: isSdkApiConfigured() ? "active" : "partial",
      detail: isSdkApiConfigured() ? "SDK API key configured" : "Set EVOLVEX_API_KEY in production",
    },
    { id: "#58", label: "Plugin system", status: "active", detail: "Plugin catalog + webhooks" },
    { id: "#59", label: "Investigation search", status: "active", detail: "Full-text search UI" },
    { id: "#60", label: "Advanced filters", status: "active", detail: "Severity, status, service filters" },
  ];
}
