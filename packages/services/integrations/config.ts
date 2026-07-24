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

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getIntegrationBaseUrl() {
  const baseUrl = process.env.BASE_URL?.trim() || "http://localhost:8000";
  return baseUrl.replace(/\/+$/, "");
}
