export function isSignozWebhookConfigured() {
  return Boolean(process.env.SIGNOZ_WEBHOOK_SECRET?.trim());
}

export function isSignozIngestionConfigured() {
  return Boolean(process.env.SIGNOZ_INGESTION_KEY?.trim());
}

export function isGithubWebhookConfigured() {
  return Boolean(process.env.GITHUB_WEBHOOK_SECRET?.trim());
}

export function isKubernetesWebhookConfigured() {
  return Boolean(process.env.KUBERNETES_WEBHOOK_SECRET?.trim());
}

export function isEbpfWebhookConfigured() {
  return Boolean(process.env.EBPF_WEBHOOK_SECRET?.trim());
}

export function isFeatureFlagWebhookConfigured() {
  return Boolean(process.env.FEATURE_FLAG_WEBHOOK_SECRET?.trim());
}

export function isCicdWebhookConfigured() {
  return Boolean(process.env.CICD_WEBHOOK_SECRET?.trim());
}

export function isSdkApiConfigured() {
  return Boolean(process.env.EVOLVEX_API_KEY?.trim()) || process.env.NODE_ENV !== "production";
}

export function isJiraConfigured() {
  return Boolean(
    process.env.JIRA_BASE_URL?.trim() &&
      process.env.JIRA_EMAIL?.trim() &&
      process.env.JIRA_API_TOKEN?.trim() &&
      process.env.JIRA_PROJECT_KEY?.trim(),
  );
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getIntegrationBaseUrl() {
  const baseUrl = process.env.BASE_URL?.trim() || "http://localhost:8000";
  return baseUrl.replace(/\/+$/, "");
}
