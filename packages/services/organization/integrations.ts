import { and, eq } from "@repo/database";
import { db } from "@repo/database";
import {
  organizationIntegrationsTable,
  organizationMembersTable,
  type OrganizationIntegrationProvider,
} from "@repo/database/schema";
import { serviceError } from "../errors";
import {
  decryptSecretPayload,
  encryptSecretPayload,
  maskSecret,
} from "../crypto/secrets";
import {
  getDefaultServiceName,
  getSignozConfig,
  getSignozWebhookPublicUrl,
  type SignozConfig,
} from "../signoz-env";
import { getIntegrationBaseUrl, isGithubWebhookConfigured, isSignozWebhookConfigured } from "../integrations/config";
import { isGithubApiConfigured } from "../github/api";
import { isSlackConfigured } from "../integrations/slack";
import { isPagerDutyConfigured } from "../integrations/pagerduty";
import { recordAuditEvent } from "../audit/log";

export type OrganizationIntegrationSummary = {
  provider: OrganizationIntegrationProvider;
  configured: boolean;
  source: "organization" | "environment";
  config: Record<string, unknown>;
  maskedSecrets: Record<string, string | null>;
  updatedAt: string | null;
};

type UpsertSignozInput = {
  cloudUrl: string;
  apiKey?: string;
  webhookSecret?: string;
  webhookPublicUrl?: string;
  defaultServiceName?: string;
  ingestionKey?: string;
};

type UpsertGithubInput = {
  token?: string;
  webhookSecret?: string;
};

type UpsertSlackInput = {
  webhookUrl?: string;
};

type UpsertPagerDutyInput = {
  routingKey?: string;
};

async function assertOrganizationOwner(userId: string, organizationId: string) {
  const [member] = await db
    .select({ role: organizationMembersTable.role })
    .from(organizationMembersTable)
    .where(
      and(
        eq(organizationMembersTable.organizationId, organizationId),
        eq(organizationMembersTable.userId, userId),
      ),
    )
    .limit(1);

  if (!member || member.role !== "owner") {
    throw serviceError("FORBIDDEN", "Organization owner access required to manage integrations");
  }
}

async function loadIntegrationRow(organizationId: string, provider: OrganizationIntegrationProvider) {
  const [row] = await db
    .select()
    .from(organizationIntegrationsTable)
    .where(
      and(
        eq(organizationIntegrationsTable.organizationId, organizationId),
        eq(organizationIntegrationsTable.provider, provider),
      ),
    )
    .limit(1);

  return row ?? null;
}

function decryptRowSecrets(row: { secretsEncrypted: string }) {
  return decryptSecretPayload(row.secretsEncrypted);
}

function mergeSecrets(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === "string" && value.trim()) {
      merged[key] = value.trim();
    }
  }
  return merged;
}

function buildSignozSummaryFromEnv(): OrganizationIntegrationSummary {
  const config = getSignozConfig();
  return {
    provider: "signoz",
    configured: Boolean(config),
    source: "environment",
    config: {
      cloudUrl: config?.cloudUrl ?? null,
      webhookPublicUrl: getSignozWebhookPublicUrl(getIntegrationBaseUrl()),
      defaultServiceName: getDefaultServiceName(),
    },
    maskedSecrets: {
      apiKey: maskSecret(config?.apiKey),
      webhookSecret: maskSecret(process.env.SIGNOZ_WEBHOOK_SECRET),
      ingestionKey: maskSecret(process.env.SIGNOZ_INGESTION_KEY),
    },
    updatedAt: null,
  };
}

function buildGithubSummaryFromEnv(): OrganizationIntegrationSummary {
  return {
    provider: "github",
    configured: isGithubApiConfigured(),
    source: "environment",
    config: {
      webhookConfigured: isGithubWebhookConfigured(),
    },
    maskedSecrets: {
      token: maskSecret(process.env.GITHUB_TOKEN),
      webhookSecret: maskSecret(process.env.GITHUB_WEBHOOK_SECRET),
    },
    updatedAt: null,
  };
}

function buildSlackSummaryFromEnv(): OrganizationIntegrationSummary {
  return {
    provider: "slack",
    configured: isSlackConfigured(),
    source: "environment",
    config: {},
    maskedSecrets: {
      webhookUrl: maskSecret(process.env.SLACK_WEBHOOK_URL),
    },
    updatedAt: null,
  };
}

function buildPagerDutySummaryFromEnv(): OrganizationIntegrationSummary {
  return {
    provider: "pagerduty",
    configured: isPagerDutyConfigured(),
    source: "environment",
    config: {},
    maskedSecrets: {
      routingKey: maskSecret(process.env.PAGERDUTY_ROUTING_KEY),
    },
    updatedAt: null,
  };
}

function summaryFromRow(row: {
  provider: OrganizationIntegrationProvider;
  config: Record<string, unknown> | null;
  secretsEncrypted: string;
  updatedAt: Date | null;
}): OrganizationIntegrationSummary {
  const secrets = decryptRowSecrets(row);
  const maskedSecrets: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(secrets)) {
    maskedSecrets[key] = maskSecret(typeof value === "string" ? value : null);
  }

  return {
    provider: row.provider,
    configured: true,
    source: "organization",
    config: row.config ?? {},
    maskedSecrets,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

export async function hasOrganizationIntegrations(organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: organizationIntegrationsTable.id })
    .from(organizationIntegrationsTable)
    .where(eq(organizationIntegrationsTable.organizationId, organizationId))
    .limit(1);

  return Boolean(row);
}

/** Lists workspace integrations — org-stored values override env fallbacks in resolution. */
export async function listOrganizationIntegrations(
  userId: string,
  organizationId: string,
): Promise<OrganizationIntegrationSummary[]> {
  await assertOrganizationOwner(userId, organizationId);

  const rows = await db
    .select()
    .from(organizationIntegrationsTable)
    .where(eq(organizationIntegrationsTable.organizationId, organizationId));

  const byProvider = new Map(rows.map((row) => [row.provider, row]));

  const providers: OrganizationIntegrationProvider[] = ["signoz", "github", "slack", "pagerduty"];
  return providers.map((provider) => {
    const row = byProvider.get(provider);
    if (row) return summaryFromRow(row);

    if (provider === "signoz") return buildSignozSummaryFromEnv();
    if (provider === "github") return buildGithubSummaryFromEnv();
    if (provider === "slack") return buildSlackSummaryFromEnv();
    return buildPagerDutySummaryFromEnv();
  });
}

export async function upsertSignozIntegration(
  userId: string,
  organizationId: string,
  input: UpsertSignozInput,
) {
  await assertOrganizationOwner(userId, organizationId);

  const cloudUrl = input.cloudUrl.trim();
  if (!cloudUrl) throw serviceError("BAD_REQUEST", "SigNoz cloud URL is required");

  const existing = await loadIntegrationRow(organizationId, "signoz");
  const existingSecrets = existing ? decryptRowSecrets(existing) : {};
  const secrets = mergeSecrets(existingSecrets, {
    apiKey: input.apiKey,
    webhookSecret: input.webhookSecret,
    ingestionKey: input.ingestionKey,
  });

  if (!secrets.apiKey) {
    throw serviceError("BAD_REQUEST", "SigNoz API key is required");
  }

  const config = {
    cloudUrl,
    webhookPublicUrl: input.webhookPublicUrl?.trim() || getSignozWebhookPublicUrl(getIntegrationBaseUrl()),
    defaultServiceName: input.defaultServiceName?.trim() || getDefaultServiceName(),
  };

  await saveIntegration(userId, organizationId, "signoz", config, secrets, "integration.signoz.upsert");
}

export async function upsertGithubIntegration(
  userId: string,
  organizationId: string,
  input: UpsertGithubInput,
) {
  await assertOrganizationOwner(userId, organizationId);

  const existing = await loadIntegrationRow(organizationId, "github");
  const existingSecrets = existing ? decryptRowSecrets(existing) : {};
  const secrets = mergeSecrets(existingSecrets, {
    token: input.token,
    webhookSecret: input.webhookSecret,
  });

  if (!secrets.token) {
    throw serviceError("BAD_REQUEST", "GitHub token is required");
  }

  await saveIntegration(userId, organizationId, "github", { webhookConfigured: Boolean(secrets.webhookSecret) }, secrets, "integration.github.upsert");
}

export async function upsertSlackIntegration(
  userId: string,
  organizationId: string,
  input: UpsertSlackInput,
) {
  await assertOrganizationOwner(userId, organizationId);

  const existing = await loadIntegrationRow(organizationId, "slack");
  const existingSecrets = existing ? decryptRowSecrets(existing) : {};
  const secrets = mergeSecrets(existingSecrets, {
    webhookUrl: input.webhookUrl,
  });

  if (!secrets.webhookUrl) {
    throw serviceError("BAD_REQUEST", "Slack webhook URL is required");
  }

  await saveIntegration(userId, organizationId, "slack", {}, secrets, "integration.slack.upsert");
}

export async function upsertPagerDutyIntegration(
  userId: string,
  organizationId: string,
  input: UpsertPagerDutyInput,
) {
  await assertOrganizationOwner(userId, organizationId);

  const existing = await loadIntegrationRow(organizationId, "pagerduty");
  const existingSecrets = existing ? decryptRowSecrets(existing) : {};
  const secrets = mergeSecrets(existingSecrets, {
    routingKey: input.routingKey,
  });

  if (!secrets.routingKey) {
    throw serviceError("BAD_REQUEST", "PagerDuty routing key is required");
  }

  await saveIntegration(userId, organizationId, "pagerduty", {}, secrets, "integration.pagerduty.upsert");
}

export async function removeOrganizationIntegration(
  userId: string,
  organizationId: string,
  provider: OrganizationIntegrationProvider,
) {
  await assertOrganizationOwner(userId, organizationId);

  await db
    .delete(organizationIntegrationsTable)
    .where(
      and(
        eq(organizationIntegrationsTable.organizationId, organizationId),
        eq(organizationIntegrationsTable.provider, provider),
      ),
    );

  await recordAuditEvent({
    actorUserId: userId,
    action: "integration.removed",
    resourceType: "organization_integration",
    resourceId: `${organizationId}:${provider}`,
    metadata: { provider },
  });
}

async function saveIntegration(
  userId: string,
  organizationId: string,
  provider: OrganizationIntegrationProvider,
  config: Record<string, unknown>,
  secrets: Record<string, unknown>,
  auditAction: string,
) {
  const secretsEncrypted = encryptSecretPayload(secrets);
  const existing = await loadIntegrationRow(organizationId, provider);

  if (existing) {
    await db
      .update(organizationIntegrationsTable)
      .set({
        config,
        secretsEncrypted,
        updatedByUserId: userId,
        updatedAt: new Date(),
      })
      .where(eq(organizationIntegrationsTable.id, existing.id));
  } else {
    await db.insert(organizationIntegrationsTable).values({
      organizationId,
      provider,
      config,
      secretsEncrypted,
      updatedByUserId: userId,
    });
  }

  await recordAuditEvent({
    actorUserId: userId,
    action: auditAction,
    resourceType: "organization_integration",
    resourceId: `${organizationId}:${provider}`,
    metadata: { provider },
  });
}

/** Resolves SigNoz credentials — org integration first, then process env. */
export async function resolveSignozConfig(organizationId?: string | null): Promise<SignozConfig | null> {
  if (organizationId) {
    const row = await loadIntegrationRow(organizationId, "signoz");
    if (row) {
      const secrets = decryptRowSecrets(row);
      const config = row.config ?? {};
      const cloudUrl = typeof config.cloudUrl === "string" ? config.cloudUrl.trim() : "";
      const apiKey = typeof secrets.apiKey === "string" ? secrets.apiKey.trim() : "";
      if (cloudUrl && apiKey) {
        return {
          cloudUrl,
          apiKey,
          webhookSecret:
            typeof secrets.webhookSecret === "string" ? secrets.webhookSecret.trim() : undefined,
        };
      }
    }
  }

  return getSignozConfig();
}

export async function resolveGithubToken(organizationId?: string | null): Promise<string | null> {
  if (organizationId) {
    const row = await loadIntegrationRow(organizationId, "github");
    if (row) {
      const secrets = decryptRowSecrets(row);
      const token = typeof secrets.token === "string" ? secrets.token.trim() : "";
      if (token) return token;
    }
  }

  return process.env.GITHUB_TOKEN?.trim() ?? null;
}

export async function resolveSlackWebhookUrl(organizationId?: string | null): Promise<string | null> {
  if (organizationId) {
    const row = await loadIntegrationRow(organizationId, "slack");
    if (row) {
      const secrets = decryptRowSecrets(row);
      const webhookUrl = typeof secrets.webhookUrl === "string" ? secrets.webhookUrl.trim() : "";
      if (webhookUrl) return webhookUrl;
    }
  }

  return process.env.SLACK_WEBHOOK_URL?.trim() ?? null;
}

export async function resolvePagerDutyRoutingKey(organizationId?: string | null): Promise<string | null> {
  if (organizationId) {
    const row = await loadIntegrationRow(organizationId, "pagerduty");
    if (row) {
      const secrets = decryptRowSecrets(row);
      const routingKey = typeof secrets.routingKey === "string" ? secrets.routingKey.trim() : "";
      if (routingKey) return routingKey;
    }
  }

  return process.env.PAGERDUTY_ROUTING_KEY?.trim() ?? null;
}

export async function isSignozConfiguredForOrganization(organizationId?: string | null) {
  const config = await resolveSignozConfig(organizationId);
  return config !== null;
}

export async function isGithubConfiguredForOrganization(organizationId?: string | null) {
  const token = await resolveGithubToken(organizationId);
  return Boolean(token);
}

export async function testSignozIntegration(organizationId?: string | null) {
  const config = await resolveSignozConfig(organizationId);
  if (!config) return { ok: false, message: "SigNoz is not configured for this workspace" };

  const url = `${config.cloudUrl.replace(/\/+$/, "")}/api/v1/service_accounts/me`;
  try {
    const response = await fetch(url, {
      headers: { "SIGNOZ-API-KEY": config.apiKey },
    });
    if (!response.ok) {
      return { ok: false, message: `SigNoz API returned ${response.status}` };
    }
    return { ok: true, message: "SigNoz API connected" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "SigNoz connection failed",
    };
  }
}

export async function testGithubIntegration(organizationId?: string | null) {
  const token = await resolveGithubToken(organizationId);
  if (!token) return { ok: false, message: "GitHub token is not configured for this workspace" };

  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "Evolvex-Investigation-OS",
      },
    });
    if (!response.ok) {
      return { ok: false, message: `GitHub API returned ${response.status}` };
    }
    const json = (await response.json()) as { login?: string };
    return {
      ok: true,
      message: json.login ? `GitHub connected as @${json.login}` : "GitHub API connected",
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "GitHub API request failed",
    };
  }
}
