export type SignozConfig = {
  cloudUrl: string;
  apiKey: string;
  webhookSecret?: string;
};

export function getSignozConfig(): SignozConfig | null {
  const cloudUrl = process.env.SIGNOZ_CLOUD_URL?.trim();
  const apiKey = process.env.SIGNOZ_API_KEY?.trim();
  if (!cloudUrl || !apiKey) return null;

  return {
    cloudUrl,
    apiKey,
    webhookSecret: process.env.SIGNOZ_WEBHOOK_SECRET?.trim() || undefined,
  };
}

export function isSignozConfigured() {
  return getSignozConfig() !== null;
}

export function getSignozWebhookPublicUrl(baseUrl: string) {
  const override = process.env.SIGNOZ_WEBHOOK_PUBLIC_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  return `${baseUrl.replace(/\/+$/, "")}/webhooks/signoz`;
}
