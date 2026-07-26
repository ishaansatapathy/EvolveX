import { and, eq } from "@repo/database";
import { db } from "@repo/database";
import {
  organizationIntegrationsTable,
  organizationMembersTable,
  type OrganizationIntegrationProvider,
  type WebhookSecretProvider,
} from "@repo/database/schema";
import { serviceError } from "../errors";
import {
  decryptSecretPayload,
  encryptSecretPayload,
  hashWebhookSecret,
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
import { isJiraConfigured, type JiraConfig } from "../jira/config";
import {
  buildKubernetesOnboardingPlan,
  generateKubernetesWebhookSecret,
  mergeKubernetesClusterMetadata,
  type KubernetesClusterMetadata,
} from "../kubernetes/onboarding";
import {
  isCicdWebhookConfigured,
  isEbpfWebhookConfigured,
  isFeatureFlagWebhookConfigured,
  isKubernetesWebhookConfigured,
} from "../integrations/config";
import { recordAuditEvent } from "../audit/log";
import { registerGithubRepositoryWebhook, type GithubWebhookRegistrationResult } from "./github-webhook-register";
import { organizationRoleAllows } from "./permissions";

/** 24h grace window — rotating a webhook secret never causes a hard outage for in-flight agents/CI runners. */
const SECRET_ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Signal-webhook providers that get the generic "Connect" UI (secret + curl example, no
 * bespoke config like SigNoz's cloudUrl/apiKey or Kubernetes's Helm command).
 */
export type WebhookSignalProvider = Exclude<WebhookSecretProvider, "kubernetes" | "signoz">;

export const WEBHOOK_SIGNAL_META: Record<
  WebhookSignalProvider,
  { path: string; header: string; envKey: string; label: string; docsHint: string }
> = {
  ebpf: {
    path: "/webhooks/ebpf",
    header: "x-evolvex-ebpf-secret",
    envKey: "EBPF_WEBHOOK_SECRET",
    label: "eBPF / OBI",
    docsHint: "Point your OBI/Pixie bridge (pnpm obi:bridge) or eBPF agent at this URL.",
  },
  feature_flag: {
    path: "/webhooks/feature-flags",
    header: "x-evolvex-flag-secret",
    envKey: "FEATURE_FLAG_WEBHOOK_SECRET",
    label: "Feature flags",
    docsHint: "LaunchDarkly/Flagsmith/OpenFeature: add this as a custom webhook with the header below.",
  },
  cicd: {
    path: "/webhooks/cicd",
    header: "x-evolvex-cicd-secret",
    envKey: "CICD_WEBHOOK_SECRET",
    label: "CI/CD",
    docsHint: "GitHub Actions / CircleCI / Jenkins / GitLab: POST build/deploy events to this URL.",
  },
};

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
  repositoryFullName?: string;
  registerWebhook?: boolean;
};

type UpsertSlackInput = {
  webhookUrl?: string;
};

type UpsertPagerDutyInput = {
  routingKey?: string;
};

type UpsertJiraInput = {
  baseUrl: string;
  email?: string;
  apiToken?: string;
  projectKey?: string;
  issueType?: string;
};

type UpsertKubernetesInput = {
  clusterName?: string;
  webhookSecret?: string;
};

async function assertOrganizationMember(userId: string, organizationId: string) {
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

  if (!member) {
    throw serviceError("FORBIDDEN", "Organization membership required");
  }

  return member;
}

async function assertOrganizationOwner(userId: string, organizationId: string) {
  const member = await assertOrganizationMember(userId, organizationId);
  if (member.role !== "owner") {
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

function buildJiraSummaryFromEnv(): OrganizationIntegrationSummary {
  const config = getJiraConfigFromEnv();
  return {
    provider: "jira",
    configured: isJiraConfigured(),
    source: "environment",
    config: {
      baseUrl: config?.baseUrl ?? null,
      projectKey: config?.projectKey ?? null,
      issueType: config?.issueType ?? "Bug",
    },
    maskedSecrets: {
      email: maskSecret(config?.email),
      apiToken: maskSecret(config?.apiToken),
    },
    updatedAt: null,
  };
}

function buildKubernetesSummaryFromEnv(): OrganizationIntegrationSummary {
  return {
    provider: "kubernetes",
    configured: isKubernetesWebhookConfigured(),
    source: "environment",
    config: {
      clusterName: process.env.KUBERNETES_CLUSTER_NAME ?? null,
      lastEventAt: null,
    },
    maskedSecrets: {
      webhookSecret: maskSecret(process.env.KUBERNETES_WEBHOOK_SECRET),
    },
    updatedAt: null,
  };
}

function getJiraConfigFromEnv(): JiraConfig | null {
  const baseUrl = process.env.JIRA_BASE_URL?.trim().replace(/\/+$/, "");
  const email = process.env.JIRA_EMAIL?.trim();
  const apiToken = process.env.JIRA_API_TOKEN?.trim();
  const projectKey = process.env.JIRA_PROJECT_KEY?.trim();

  if (!baseUrl || !email || !apiToken || !projectKey) return null;

  return {
    baseUrl,
    email,
    apiToken,
    projectKey,
    issueType: process.env.JIRA_ISSUE_TYPE?.trim() || "Bug",
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
  const member = await assertOrganizationMember(userId, organizationId);
  if (!organizationRoleAllows(member.role, "view_integrations")) {
    throw serviceError("FORBIDDEN", "Insufficient permissions to view workspace integrations");
  }

  const rows = await db
    .select()
    .from(organizationIntegrationsTable)
    .where(eq(organizationIntegrationsTable.organizationId, organizationId));

  const byProvider = new Map(rows.map((row) => [row.provider, row]));

  const providers: OrganizationIntegrationProvider[] = [
    "signoz",
    "github",
    "slack",
    "pagerduty",
    "jira",
    "kubernetes",
    "ebpf",
    "feature_flag",
    "cicd",
  ];
  return providers.map((provider) => {
    const row = byProvider.get(provider);
    if (row) return summaryFromRow(row);

    if (provider === "signoz") return buildSignozSummaryFromEnv();
    if (provider === "github") return buildGithubSummaryFromEnv();
    if (provider === "slack") return buildSlackSummaryFromEnv();
    if (provider === "jira") return buildJiraSummaryFromEnv();
    if (provider === "kubernetes") return buildKubernetesSummaryFromEnv();
    if (provider === "ebpf") return buildEbpfSummaryFromEnv();
    if (provider === "feature_flag") return buildFeatureFlagSummaryFromEnv();
    if (provider === "cicd") return buildCicdSummaryFromEnv();
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

  // Uses the hash-indexed save path (not plain `saveIntegration`) so this workspace's alert
  // webhook secret — whether typed here or generated later via `generateSignozWebhookOnboarding`
  // — is resolvable in O(1) by `resolveOrganizationIdForWebhookSecret("signoz", secret)`.
  await saveIntegrationWithSecretHash(userId, organizationId, "signoz", config, secrets, "integration.signoz.upsert");
}

export type SignozWebhookOnboardingResult = {
  webhookUrl: string;
  webhookUsername: string;
  webhookSecret: string;
  maskedWebhookSecret: string | null;
  configured: boolean;
  source: "organization";
};

/**
 * Self-service SigNoz alert-webhook onboarding: generates (or returns/rotates) a workspace-scoped
 * Basic-auth password so alerts route straight to this organization via the indexed `secret_hash`
 * lookup — the same pattern Kubernetes/eBPF/CI-CD webhooks use — instead of every case landing in
 * whichever workspace owns the single global `INVESTIGATION_OWNER_EMAIL`. Requires SigNoz cloud
 * URL + API key to already be saved (`upsertSignozIntegration`).
 */
export async function generateSignozWebhookOnboarding(
  userId: string,
  organizationId: string,
  input?: { rotateSecret?: boolean },
): Promise<SignozWebhookOnboardingResult> {
  await assertOrganizationOwner(userId, organizationId);

  const existing = await loadIntegrationRow(organizationId, "signoz");
  if (!existing) {
    throw serviceError(
      "BAD_REQUEST",
      "Save SigNoz cloud URL and API key first, then generate webhook credentials",
    );
  }

  const existingSecrets = decryptRowSecrets(existing);
  const hasExistingSecret =
    typeof existingSecrets.webhookSecret === "string" && existingSecrets.webhookSecret.trim();

  let webhookSecret: string;
  if (input?.rotateSecret && hasExistingSecret) {
    webhookSecret = await rotateWebhookSecretProvider(userId, organizationId, "signoz");
  } else if (hasExistingSecret) {
    webhookSecret = String(existingSecrets.webhookSecret);
  } else {
    webhookSecret = generateKubernetesWebhookSecret();
    await saveIntegrationWithSecretHash(
      userId,
      organizationId,
      "signoz",
      existing.config ?? {},
      { ...existingSecrets, webhookSecret },
      "integration.signoz.webhook_onboard",
    );
  }

  const baseUrl = getIntegrationBaseUrl().replace(/\/+$/, "");

  return {
    webhookUrl: `${baseUrl}/webhooks/signoz`,
    webhookUsername: "evolvex",
    webhookSecret,
    maskedWebhookSecret: maskSecret(webhookSecret),
    configured: true,
    source: "organization",
  };
}

export async function upsertGithubIntegration(
  userId: string,
  organizationId: string,
  input: UpsertGithubInput,
) {
  await assertOrganizationOwner(userId, organizationId);

  const existing = await loadIntegrationRow(organizationId, "github");
  const existingSecrets = existing ? decryptRowSecrets(existing) : {};
  const existingConfig = existing?.config ?? {};
  const secrets = mergeSecrets(existingSecrets, {
    token: input.token,
    webhookSecret: input.webhookSecret,
  });

  if (!secrets.token) {
    throw serviceError("BAD_REQUEST", "GitHub token is required");
  }

  const repositoryFullName =
    input.repositoryFullName?.trim() ||
    (typeof existingConfig.repositoryFullName === "string" ? existingConfig.repositoryFullName.trim() : "");

  let webhookRegistration: GithubWebhookRegistrationResult | null = null;
  const shouldRegisterWebhook = input.registerWebhook !== false;
  if (shouldRegisterWebhook && repositoryFullName && secrets.webhookSecret) {
    webhookRegistration = await registerGithubRepositoryWebhook({
      token: String(secrets.token),
      repositoryFullName,
      webhookSecret: String(secrets.webhookSecret),
    });

    if (!webhookRegistration.ok) {
      throw serviceError("BAD_REQUEST", webhookRegistration.message);
    }
  }

  await saveIntegration(
    userId,
    organizationId,
    "github",
    {
      webhookConfigured: Boolean(secrets.webhookSecret),
      repositoryFullName: repositoryFullName || null,
      webhookHookId: webhookRegistration?.hookId ?? existingConfig.webhookHookId ?? null,
      webhookRegisteredAt: webhookRegistration?.ok
        ? new Date().toISOString()
        : (existingConfig.webhookRegisteredAt ?? null),
    },
    secrets,
    "integration.github.upsert",
  );

  return webhookRegistration;
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

  const config = { ...(existing?.config ?? {}), connectedVia: "manual" };

  await saveIntegration(userId, organizationId, "slack", config, secrets, "integration.slack.upsert");
}

/**
 * Completes the "Add to Slack" OAuth flow — called from the OAuth callback route once Slack has
 * granted a bot token + incoming webhook. No user-facing form, no token to find/copy: this is the
 * same one-click bar as connecting SigNoz Cloud, but for Slack specifically no secret ever needs
 * to be located by the user in the first place.
 */
export async function completeSlackOAuthConnection(
  userId: string,
  organizationId: string,
  connection: { teamId: string; teamName: string; webhookUrl: string; webhookChannel: string | null; botAccessToken: string },
) {
  await assertOrganizationOwner(userId, organizationId);

  const secrets = {
    webhookUrl: connection.webhookUrl,
    botAccessToken: connection.botAccessToken,
  };

  const config = {
    connectedVia: "oauth",
    teamId: connection.teamId,
    teamName: connection.teamName,
    channel: connection.webhookChannel,
    connectedAt: new Date().toISOString(),
  };

  await saveIntegration(userId, organizationId, "slack", config, secrets, "integration.slack.oauth_connect");
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

export async function upsertJiraIntegration(
  userId: string,
  organizationId: string,
  input: UpsertJiraInput,
) {
  await assertOrganizationOwner(userId, organizationId);

  const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) throw serviceError("BAD_REQUEST", "Jira base URL is required");

  const existing = await loadIntegrationRow(organizationId, "jira");
  const existingSecrets = existing ? decryptRowSecrets(existing) : {};
  const existingConfig = existing?.config ?? {};
  const secrets = mergeSecrets(existingSecrets, {
    email: input.email,
    apiToken: input.apiToken,
  });

  const projectKey =
    input.projectKey?.trim() ||
    (typeof existingConfig.projectKey === "string" ? existingConfig.projectKey.trim() : "");

  if (!secrets.email) {
    throw serviceError("BAD_REQUEST", "Jira email is required");
  }
  if (!secrets.apiToken) {
    throw serviceError("BAD_REQUEST", "Jira API token is required");
  }
  if (!projectKey) {
    throw serviceError("BAD_REQUEST", "Jira project key is required");
  }

  const config = {
    baseUrl,
    projectKey,
    issueType:
      input.issueType?.trim() ||
      (typeof existingConfig.issueType === "string" ? existingConfig.issueType.trim() : "") ||
      "Bug",
  };

  await saveIntegration(userId, organizationId, "jira", config, secrets, "integration.jira.upsert");
}

export async function generateKubernetesOnboarding(
  userId: string,
  organizationId: string,
  input?: { clusterName?: string; rotateSecret?: boolean },
) {
  await assertOrganizationOwner(userId, organizationId);

  const existing = await loadIntegrationRow(organizationId, "kubernetes");
  const existingSecrets = existing ? decryptRowSecrets(existing) : {};
  const existingConfig = existing?.config ?? {};
  const hasExistingSecret = typeof existingSecrets.webhookSecret === "string" && existingSecrets.webhookSecret;

  const clusterName =
    input?.clusterName?.trim() ||
    (typeof existingConfig.clusterName === "string" ? existingConfig.clusterName.trim() : "") ||
    "production";

  const signozRow = await loadIntegrationRow(organizationId, "signoz");
  const signozSecrets = signozRow ? decryptRowSecrets(signozRow) : {};
  const ingestionKey =
    typeof signozSecrets.ingestionKey === "string"
      ? signozSecrets.ingestionKey.trim()
      : process.env.SIGNOZ_INGESTION_KEY?.trim();

  const nextConfig = {
    clusterName,
    lastEventAt: existingConfig.lastEventAt ?? null,
    clusterMetadata: existingConfig.clusterMetadata ?? {},
    helmInstalledAt: existingConfig.helmInstalledAt ?? new Date().toISOString(),
  };

  let webhookSecret: string;
  if (input?.rotateSecret && hasExistingSecret) {
    // Rotate via the grace-window path (24h dual-secret validity) instead of a hard cutover,
    // then persist the fresh cluster/onboarding config alongside the already-rotated secret.
    webhookSecret = await rotateWebhookSecretProvider(userId, organizationId, "kubernetes");
    const rotated = await loadIntegrationRow(organizationId, "kubernetes");
    await saveIntegrationWithSecretHash(
      userId,
      organizationId,
      "kubernetes",
      nextConfig,
      { webhookSecret },
      "integration.kubernetes.onboard",
      rotated
        ? { previousSecretHash: rotated.previousSecretHash, previousSecretExpiresAt: rotated.previousSecretExpiresAt }
        : undefined,
    );
  } else {
    webhookSecret = hasExistingSecret ? String(existingSecrets.webhookSecret) : generateKubernetesWebhookSecret();
    await saveIntegrationWithSecretHash(
      userId,
      organizationId,
      "kubernetes",
      nextConfig,
      { webhookSecret },
      "integration.kubernetes.onboard",
    );
  }

  const plan = buildKubernetesOnboardingPlan({
    organizationId,
    clusterName,
    webhookSecret,
    signozOtlpEndpoint: process.env.SIGNOZ_OTLP_ENDPOINT?.trim(),
    signozIngestionKey: ingestionKey,
  });

  return {
    ...plan,
    maskedWebhookSecret: maskSecret(webhookSecret),
    configured: true,
    source: "organization" as const,
  };
}

export async function upsertKubernetesIntegration(
  userId: string,
  organizationId: string,
  input: UpsertKubernetesInput,
) {
  await assertOrganizationOwner(userId, organizationId);

  const existing = await loadIntegrationRow(organizationId, "kubernetes");
  const existingSecrets = existing ? decryptRowSecrets(existing) : {};
  const existingConfig = existing?.config ?? {};
  const secrets = mergeSecrets(existingSecrets, {
    webhookSecret: input.webhookSecret,
  });

  if (!secrets.webhookSecret) {
    throw serviceError("BAD_REQUEST", "Kubernetes webhook secret is required");
  }

  const config = {
    clusterName:
      input.clusterName?.trim() ||
      (typeof existingConfig.clusterName === "string" ? existingConfig.clusterName.trim() : "") ||
      "production",
    lastEventAt: existingConfig.lastEventAt ?? null,
    clusterMetadata: existingConfig.clusterMetadata ?? {},
    helmInstalledAt: existingConfig.helmInstalledAt ?? null,
  };

  await saveIntegrationWithSecretHash(
    userId,
    organizationId,
    "kubernetes",
    config,
    secrets,
    "integration.kubernetes.upsert",
  );
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

/**
 * Same as `saveIntegration`, but also maintains the `secret_hash` / `previous_secret_hash`
 * columns for the shared-secret webhook providers (kubernetes/ebpf/feature_flag/cicd). This is
 * what makes `resolveOrganizationIdForWebhookSecret` an indexed O(1) lookup instead of a full
 * table scan that decrypts every row on every inbound webhook.
 */
async function saveIntegrationWithSecretHash(
  userId: string,
  organizationId: string,
  provider: WebhookSecretProvider,
  config: Record<string, unknown>,
  secrets: Record<string, unknown>,
  auditAction: string,
  rotation?: { previousSecretHash: string | null; previousSecretExpiresAt: Date | null },
) {
  const secretsEncrypted = encryptSecretPayload(secrets);
  const secretHash = typeof secrets.webhookSecret === "string" ? hashWebhookSecret(secrets.webhookSecret) : null;
  const existing = await loadIntegrationRow(organizationId, provider);

  const values = {
    config,
    secretsEncrypted,
    secretHash,
    previousSecretHash: rotation?.previousSecretHash ?? null,
    previousSecretExpiresAt: rotation?.previousSecretExpiresAt ?? null,
    updatedByUserId: userId,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(organizationIntegrationsTable).set(values).where(eq(organizationIntegrationsTable.id, existing.id));
  } else {
    await db.insert(organizationIntegrationsTable).values({ organizationId, provider, ...values });
  }

  await recordAuditEvent({
    actorUserId: userId,
    action: auditAction,
    resourceType: "organization_integration",
    resourceId: `${organizationId}:${provider}`,
    metadata: { provider },
  });
}

/**
 * Resolves which organization owns a shared webhook secret in O(1) via the indexed `secret_hash`
 * column — no decrypting every `organization_integrations` row on every inbound webhook. Also
 * honors a still-valid rotated-out `previous_secret_hash` so rotating a secret in Settings never
 * causes an in-flight agent/CI runner to start failing before it's redeployed with the new value.
 */
export async function resolveOrganizationIdForWebhookSecret(
  provider: WebhookSecretProvider,
  secret: string,
): Promise<string | null> {
  const hash = hashWebhookSecret(secret);

  const [current] = await db
    .select({ organizationId: organizationIntegrationsTable.organizationId })
    .from(organizationIntegrationsTable)
    .where(and(eq(organizationIntegrationsTable.provider, provider), eq(organizationIntegrationsTable.secretHash, hash)))
    .limit(1);
  if (current) return current.organizationId;

  const [rotatedOut] = await db
    .select({
      organizationId: organizationIntegrationsTable.organizationId,
      previousSecretExpiresAt: organizationIntegrationsTable.previousSecretExpiresAt,
    })
    .from(organizationIntegrationsTable)
    .where(
      and(
        eq(organizationIntegrationsTable.provider, provider),
        eq(organizationIntegrationsTable.previousSecretHash, hash),
      ),
    )
    .limit(1);

  if (rotatedOut?.previousSecretExpiresAt && rotatedOut.previousSecretExpiresAt.getTime() > Date.now()) {
    return rotatedOut.organizationId;
  }

  return null;
}

/**
 * Generates a fresh secret for a shared-secret webhook provider and keeps the old one valid for a
 * grace window, so rotating in Settings doesn't break an agent/CI runner still using the old value.
 */
export async function rotateWebhookSecretProvider(
  userId: string,
  organizationId: string,
  provider: WebhookSecretProvider,
): Promise<string> {
  await assertOrganizationOwner(userId, organizationId);

  const existing = await loadIntegrationRow(organizationId, provider);
  const existingSecrets = existing ? decryptRowSecrets(existing) : {};
  const oldSecret = typeof existingSecrets.webhookSecret === "string" ? existingSecrets.webhookSecret : null;
  const newSecret = generateKubernetesWebhookSecret();

  await saveIntegrationWithSecretHash(
    userId,
    organizationId,
    provider,
    existing?.config ?? {},
    { ...existingSecrets, webhookSecret: newSecret },
    `integration.${provider}.secret_rotated`,
    oldSecret
      ? {
          previousSecretHash: hashWebhookSecret(oldSecret),
          previousSecretExpiresAt: new Date(Date.now() + SECRET_ROTATION_GRACE_MS),
        }
      : undefined,
  );

  return newSecret;
}

function buildEbpfSummaryFromEnv(): OrganizationIntegrationSummary {
  return {
    provider: "ebpf",
    configured: isEbpfWebhookConfigured(),
    source: "environment",
    config: { lastEventAt: null },
    maskedSecrets: { webhookSecret: maskSecret(process.env.EBPF_WEBHOOK_SECRET) },
    updatedAt: null,
  };
}

function buildFeatureFlagSummaryFromEnv(): OrganizationIntegrationSummary {
  return {
    provider: "feature_flag",
    configured: isFeatureFlagWebhookConfigured(),
    source: "environment",
    config: { lastEventAt: null },
    maskedSecrets: { webhookSecret: maskSecret(process.env.FEATURE_FLAG_WEBHOOK_SECRET) },
    updatedAt: null,
  };
}

function buildCicdSummaryFromEnv(): OrganizationIntegrationSummary {
  return {
    provider: "cicd",
    configured: isCicdWebhookConfigured(),
    source: "environment",
    config: { lastEventAt: null },
    maskedSecrets: { webhookSecret: maskSecret(process.env.CICD_WEBHOOK_SECRET) },
    updatedAt: null,
  };
}

/**
 * Self-service "Connect" for the signal webhooks (eBPF/feature-flag/CI-CD) — same shape as
 * `generateKubernetesOnboarding` but without a Helm chart: generates an org-scoped secret (or
 * returns the existing one) and the ready-to-paste webhook URL + curl example for the source tool.
 */
export async function generateWebhookSignalOnboarding(
  userId: string,
  organizationId: string,
  provider: WebhookSignalProvider,
  input?: { rotateSecret?: boolean },
) {
  await assertOrganizationOwner(userId, organizationId);

  const meta = WEBHOOK_SIGNAL_META[provider];
  const existing = await loadIntegrationRow(organizationId, provider);
  const existingSecrets = existing ? decryptRowSecrets(existing) : {};
  const hasExistingSecret = typeof existingSecrets.webhookSecret === "string" && existingSecrets.webhookSecret;

  let webhookSecret: string;
  if (input?.rotateSecret && hasExistingSecret) {
    webhookSecret = await rotateWebhookSecretProvider(userId, organizationId, provider);
  } else if (hasExistingSecret) {
    webhookSecret = String(existingSecrets.webhookSecret);
  } else {
    webhookSecret = generateKubernetesWebhookSecret();
    await saveIntegrationWithSecretHash(
      userId,
      organizationId,
      provider,
      existing?.config ?? { lastEventAt: null },
      { webhookSecret },
      `integration.${provider}.onboard`,
    );
  }

  const baseUrl = getIntegrationBaseUrl();
  const webhookUrl = `${baseUrl}${meta.path}`;

  return {
    provider,
    label: meta.label,
    webhookUrl,
    webhookSecret,
    maskedWebhookSecret: maskSecret(webhookSecret),
    headerName: meta.header,
    docsHint: meta.docsHint,
    curlExample: [
      `curl -X POST ${webhookUrl} \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "${meta.header}: ${webhookSecret}" \\`,
      `  -d '{"...": "..."}'`,
    ].join("\n"),
    configured: true,
    source: "organization" as const,
  };
}

/** Records that a signal webhook (eBPF/feature-flag/CI-CD) delivered an event — drives the live "Connected" status in Settings. */
export async function recordWebhookSignalEvent(input: {
  organizationId: string;
  provider: WebhookSignalProvider;
  summary?: string | null;
}) {
  const row = await loadIntegrationRow(input.organizationId, input.provider);
  if (!row) return;

  await db
    .update(organizationIntegrationsTable)
    .set({
      config: {
        ...(row.config ?? {}),
        lastEventAt: new Date().toISOString(),
        lastEventSummary: input.summary ?? (row.config?.lastEventSummary ?? null),
      },
      updatedAt: new Date(),
    })
    .where(eq(organizationIntegrationsTable.id, row.id));
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

export async function resolveGithubWebhookSecret(organizationId?: string | null): Promise<string | null> {
  if (organizationId) {
    const row = await loadIntegrationRow(organizationId, "github");
    if (row) {
      const secrets = decryptRowSecrets(row);
      const webhookSecret =
        typeof secrets.webhookSecret === "string" ? secrets.webhookSecret.trim() : "";
      if (webhookSecret) return webhookSecret;
    }
  }

  return process.env.GITHUB_WEBHOOK_SECRET?.trim() ?? null;
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

export async function resolveKubernetesWebhookSecret(organizationId?: string | null): Promise<string | null> {
  if (organizationId) {
    const row = await loadIntegrationRow(organizationId, "kubernetes");
    if (row) {
      const secrets = decryptRowSecrets(row);
      const webhookSecret =
        typeof secrets.webhookSecret === "string" ? secrets.webhookSecret.trim() : "";
      if (webhookSecret) return webhookSecret;
    }
  }

  return process.env.KUBERNETES_WEBHOOK_SECRET?.trim() ?? null;
}

/** @deprecated Use `resolveOrganizationIdForWebhookSecret("kubernetes", secret)` — kept as a thin alias. */
export async function resolveOrganizationIdForKubernetesWebhook(secret: string) {
  return resolveOrganizationIdForWebhookSecret("kubernetes", secret);
}

export async function recordKubernetesClusterHeartbeat(input: {
  organizationId: string;
  metadata?: KubernetesClusterMetadata;
}) {
  const row = await loadIntegrationRow(input.organizationId, "kubernetes");
  if (!row) return;

  const config = row.config ?? {};
  const existingMetadata = (config.clusterMetadata as KubernetesClusterMetadata | undefined) ?? {};
  const merged = mergeKubernetesClusterMetadata(existingMetadata, input.metadata ?? {});

  await db
    .update(organizationIntegrationsTable)
    .set({
      config: {
        ...config,
        clusterMetadata: merged,
        lastEventAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(organizationIntegrationsTable.id, row.id));
}

export async function isKubernetesConfiguredForOrganization(organizationId?: string | null) {
  const secret = await resolveKubernetesWebhookSecret(organizationId);
  return Boolean(secret);
}

export async function resolveJiraConfig(organizationId?: string | null): Promise<JiraConfig | null> {
  if (organizationId) {
    const row = await loadIntegrationRow(organizationId, "jira");
    if (row) {
      const secrets = decryptRowSecrets(row);
      const config = row.config ?? {};
      const baseUrl = typeof config.baseUrl === "string" ? config.baseUrl.trim().replace(/\/+$/, "") : "";
      const email = typeof secrets.email === "string" ? secrets.email.trim() : "";
      const apiToken = typeof secrets.apiToken === "string" ? secrets.apiToken.trim() : "";
      const projectKey = typeof config.projectKey === "string" ? config.projectKey.trim() : "";
      const issueType =
        typeof config.issueType === "string" && config.issueType.trim()
          ? config.issueType.trim()
          : "Bug";

      if (baseUrl && email && apiToken && projectKey) {
        return { baseUrl, email, apiToken, projectKey, issueType };
      }
    }
  }

  return getJiraConfigFromEnv();
}

export async function isJiraConfiguredForOrganization(organizationId?: string | null) {
  const config = await resolveJiraConfig(organizationId);
  return config !== null;
}

export async function isSignozConfiguredForOrganization(organizationId?: string | null) {
  const config = await resolveSignozConfig(organizationId);
  return config !== null;
}

export async function isGithubConfiguredForOrganization(organizationId?: string | null) {
  const token = await resolveGithubToken(organizationId);
  return Boolean(token);
}

export async function isGithubWebhookConfiguredForOrganization(organizationId?: string | null) {
  const secret = await resolveGithubWebhookSecret(organizationId);
  return Boolean(secret);
}

export type GithubIntegrationTestResult = {
  ok: boolean;
  message: string;
  login?: string;
  scopes?: string[];
  hasRepoScope?: boolean;
  rateLimitRemaining?: number;
};

function parseGithubScopes(headerValue: string | null): string[] {
  if (!headerValue) return [];
  return headerValue
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function hasGithubRepoScope(scopes: string[]) {
  return scopes.some((scope) => scope === "repo" || scope.startsWith("repo:"));
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

export async function testGithubIntegration(
  organizationId?: string | null,
): Promise<GithubIntegrationTestResult> {
  const token = await resolveGithubToken(organizationId);
  if (!token) {
    return { ok: false, message: "GitHub token is not configured — paste a PAT below or set GITHUB_TOKEN in .env" };
  }

  if (!/^(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)/.test(token)) {
    return {
      ok: false,
      message: "Token format looks invalid — use a GitHub personal access token (classic or fine-grained)",
    };
  }

  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "Evolvex-Investigation-OS",
      },
    });
    if (!response.ok) {
      const hint =
        response.status === 401
          ? " — token expired or revoked; create a new PAT"
          : response.status === 403
            ? " — check token scopes (repo required for private repos)"
            : "";
      return { ok: false, message: `GitHub API returned ${response.status}${hint}` };
    }

    const json = (await response.json()) as { login?: string };
    const scopes = parseGithubScopes(response.headers.get("x-oauth-scopes"));
    const repoScope = hasGithubRepoScope(scopes);
    const rateLimitRemaining = Number.parseInt(response.headers.get("x-ratelimit-remaining") ?? "", 10);
    const login = json.login ?? undefined;

    const scopeLabel = scopes.length > 0 ? scopes.join(", ") : "fine-grained (repo access via token settings)";
    let message = login
      ? `Connected as @${login} · scopes: ${scopeLabel}`
      : `GitHub API connected · scopes: ${scopeLabel}`;

    if (Number.isFinite(rateLimitRemaining)) {
      message += ` · rate limit: ${rateLimitRemaining} remaining`;
    }

    if (scopes.length > 0 && !repoScope) {
      message += " · warning: no repo scope — private repo pinpoint/deploy diff may fail";
    }

    return {
      ok: true,
      message,
      login,
      scopes: scopes.length > 0 ? scopes : undefined,
      hasRepoScope: scopes.length > 0 ? repoScope : undefined,
      rateLimitRemaining: Number.isFinite(rateLimitRemaining) ? rateLimitRemaining : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "GitHub API request failed",
    };
  }
}

export async function testJiraIntegration(organizationId?: string | null) {
  const config = await resolveJiraConfig(organizationId);
  if (!config) {
    return {
      ok: false,
      message: "Jira is not configured — connect in workspace settings or set JIRA_* env vars",
    };
  }

  const token = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");

  try {
    const response = await fetch(`${config.baseUrl}/rest/api/3/myself`, {
      headers: {
        Authorization: `Basic ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const hint =
        response.status === 401
          ? " — check email and API token"
          : response.status === 403
            ? " — token lacks required permissions"
            : "";
      return { ok: false, message: `Jira API returned ${response.status}${hint}` };
    }

    const json = (await response.json()) as { displayName?: string; emailAddress?: string };
    const who = json.displayName ?? json.emailAddress ?? config.email;
    return {
      ok: true,
      message: `Connected as ${who} · project ${config.projectKey} · issue type ${config.issueType}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Jira connection failed",
    };
  }
}

/** Posts a real "Evolvex is connected" message — incoming webhooks have no dry-run/validate endpoint. */
export async function testSlackIntegration(organizationId?: string | null) {
  const webhookUrl = await resolveSlackWebhookUrl(organizationId);
  if (!webhookUrl) {
    return { ok: false, message: "Slack is not connected — use Add to Slack or paste a webhook URL below" };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: ":white_check_mark: Evolvex is connected — investigation-ready and case-resolved alerts will post here.",
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const hint = response.status === 404 ? " — webhook was likely revoked; reconnect Slack" : "";
      return { ok: false, message: `Slack returned ${response.status}${hint}${body ? `: ${body.slice(0, 120)}` : ""}` };
    }

    return { ok: true, message: "Test message sent — check the Slack channel" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Slack connection failed",
    };
  }
}

/** Triggers then immediately resolves a dedup'd test event — validates the routing key without leaving an open incident. */
export async function testPagerDutyIntegration(organizationId?: string | null) {
  const routingKey = await resolvePagerDutyRoutingKey(organizationId);
  if (!routingKey) {
    return { ok: false, message: "PagerDuty is not connected — paste an Events API v2 routing key below" };
  }

  const dedupKey = `evolvex-connection-test-${Date.now()}`;
  const trigger = async (eventAction: "trigger" | "resolve") =>
    fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routing_key: routingKey,
        event_action: eventAction,
        dedup_key: dedupKey,
        payload:
          eventAction === "trigger"
            ? {
                summary: "Evolvex connection test (auto-resolves immediately)",
                source: "evolvex",
                severity: "info",
              }
            : undefined,
      }),
    });

  try {
    const response = await trigger("trigger");
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const hint = response.status === 400 ? " — check the routing key" : "";
      return { ok: false, message: `PagerDuty returned ${response.status}${hint}${body ? `: ${body.slice(0, 120)}` : ""}` };
    }
    await trigger("resolve").catch(() => undefined);
    return { ok: true, message: "Routing key verified — a test event was sent and auto-resolved" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "PagerDuty connection failed",
    };
  }
}
