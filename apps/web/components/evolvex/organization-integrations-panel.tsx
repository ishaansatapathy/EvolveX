"use client";

import { useMemo, useState } from "react";

import { trpc } from "~/trpc/client";

type IntegrationSummary = {
  provider: "signoz" | "github" | "slack" | "pagerduty";
  configured: boolean;
  source: "organization" | "environment";
  config: Record<string, unknown>;
  maskedSecrets: Record<string, string | null>;
  updatedAt: string | null;
};

type OrganizationIntegrationsPanelProps = {
  organizationId?: string;
  organizationName?: string;
  isOwner: boolean;
};

const PROVIDER_LABELS: Record<IntegrationSummary["provider"], string> = {
  signoz: "SigNoz",
  github: "GitHub",
  slack: "Slack",
  pagerduty: "PagerDuty",
};

export function OrganizationIntegrationsPanel({
  organizationId,
  organizationName,
  isOwner,
}: OrganizationIntegrationsPanelProps) {
  const utils = trpc.useUtils();
  const integrationsQuery = trpc.organizations.integrations.list.useQuery(
    { organizationId },
    { enabled: Boolean(organizationId) && isOwner },
  );

  const upsertSignoz = trpc.organizations.integrations.upsertSignoz.useMutation({
    onSuccess: async () => {
      await utils.organizations.integrations.list.invalidate();
      await utils.integrations.health.invalidate();
    },
  });
  const upsertGithub = trpc.organizations.integrations.upsertGithub.useMutation({
    onSuccess: async () => {
      await utils.organizations.integrations.list.invalidate();
      await utils.integrations.health.invalidate();
    },
  });
  const upsertSlack = trpc.organizations.integrations.upsertSlack.useMutation({
    onSuccess: async () => {
      await utils.organizations.integrations.list.invalidate();
      await utils.integrations.health.invalidate();
    },
  });
  const upsertPagerDuty = trpc.organizations.integrations.upsertPagerDuty.useMutation({
    onSuccess: async () => {
      await utils.organizations.integrations.list.invalidate();
      await utils.integrations.health.invalidate();
    },
  });
  const removeIntegration = trpc.organizations.integrations.remove.useMutation({
    onSuccess: async () => {
      await utils.organizations.integrations.list.invalidate();
      await utils.integrations.health.invalidate();
    },
  });

  const signozTest = trpc.organizations.integrations.testSignoz.useQuery(
    { organizationId },
    { enabled: false },
  );
  const githubTest = trpc.organizations.integrations.testGithub.useQuery(
    { organizationId },
    { enabled: false },
  );

  const [signozForm, setSignozForm] = useState({
    cloudUrl: "",
    apiKey: "",
    webhookSecret: "",
    webhookPublicUrl: "",
    defaultServiceName: "",
    ingestionKey: "",
  });
  const [githubForm, setGithubForm] = useState({ token: "", webhookSecret: "" });
  const [slackForm, setSlackForm] = useState({ webhookUrl: "" });
  const [pagerDutyForm, setPagerDutyForm] = useState({ routingKey: "" });
  const [message, setMessage] = useState<string | null>(null);

  const byProvider = useMemo(() => {
    const map = new Map<IntegrationSummary["provider"], IntegrationSummary>();
    for (const item of integrationsQuery.data ?? []) {
      map.set(item.provider, item);
    }
    return map;
  }, [integrationsQuery.data]);

  if (!isOwner) {
    return (
      <section className="evx-dash__integration-health" style={{ marginTop: "1rem" }}>
        <p className="evx-dash__context-card-title">Workspace integrations</p>
        <p className="evx-dash__stat-note">
          Only workspace owners can connect SigNoz, GitHub, Slack, and PagerDuty. Ask an owner of{" "}
          {organizationName ?? "this workspace"} to configure integrations.
        </p>
      </section>
    );
  }

  async function handleTest(provider: "signoz" | "github") {
    const result =
      provider === "signoz" ? await signozTest.refetch() : await githubTest.refetch();
    setMessage(result.data?.message ?? "Connection test failed");
  }

  function renderSourceBadge(item?: IntegrationSummary) {
    if (!item?.configured) return <span className="evx-dash__chip st-missing">Not connected</span>;
    if (item.source === "organization") {
      return <span className="evx-dash__chip st-collected">Workspace vault</span>;
    }
    return <span className="evx-dash__chip st-partial">From .env fallback</span>;
  }

  return (
    <section className="evx-dash__integration-health" style={{ marginTop: "1rem" }}>
      <div className="evx-dash__integration-health-head">
        <div>
          <p className="evx-dash__context-card-title">Connect integrations</p>
          <p className="evx-dash__stat-note">
            Per-workspace credentials are encrypted at rest. Leave secret fields blank to keep the current value.
          </p>
        </div>
      </div>

      {message ? (
        <p className="evx-dash__stat-note" style={{ marginBottom: "0.75rem" }}>
          {message}
        </p>
      ) : null}

      <div className="evx-dash__org-integrations-grid">
        <article className="evx-dash__settings-card">
          <div className="evx-dash__org-integration-head">
            <p className="evx-dash__settings-label">{PROVIDER_LABELS.signoz}</p>
            {renderSourceBadge(byProvider.get("signoz"))}
          </div>
          <label className="evx-dash__org-field">
            <span>Cloud URL</span>
            <input
              type="url"
              placeholder="https://your-org.signoz.cloud"
              value={signozForm.cloudUrl || String(byProvider.get("signoz")?.config.cloudUrl ?? "")}
              onChange={(event) => setSignozForm((prev) => ({ ...prev, cloudUrl: event.target.value }))}
            />
          </label>
          <label className="evx-dash__org-field">
            <span>API key {byProvider.get("signoz")?.maskedSecrets.apiKey ? `(${byProvider.get("signoz")?.maskedSecrets.apiKey})` : ""}</span>
            <input
              type="password"
              placeholder="Leave blank to keep existing"
              value={signozForm.apiKey}
              onChange={(event) => setSignozForm((prev) => ({ ...prev, apiKey: event.target.value }))}
            />
          </label>
          <label className="evx-dash__org-field">
            <span>Webhook secret</span>
            <input
              type="password"
              placeholder="Optional — leave blank to keep existing"
              value={signozForm.webhookSecret}
              onChange={(event) => setSignozForm((prev) => ({ ...prev, webhookSecret: event.target.value }))}
            />
          </label>
          <div className="evx-dash__cause-actions">
            <button
              type="button"
              className="evx-dash__btn-primary"
              disabled={upsertSignoz.isPending}
              onClick={async () => {
                await upsertSignoz.mutateAsync({
                  organizationId,
                  cloudUrl: signozForm.cloudUrl || String(byProvider.get("signoz")?.config.cloudUrl ?? ""),
                  apiKey: signozForm.apiKey || undefined,
                  webhookSecret: signozForm.webhookSecret || undefined,
                  webhookPublicUrl: signozForm.webhookPublicUrl || undefined,
                  defaultServiceName: signozForm.defaultServiceName || undefined,
                  ingestionKey: signozForm.ingestionKey || undefined,
                });
                setMessage("SigNoz credentials saved to workspace vault.");
              }}
            >
              Save SigNoz
            </button>
            <button type="button" className="evx-dash__btn-ghost" onClick={() => handleTest("signoz")}>
              Test
            </button>
            {byProvider.get("signoz")?.source === "organization" ? (
              <button
                type="button"
                className="evx-dash__btn-ghost"
                onClick={async () => {
                  await removeIntegration.mutateAsync({ organizationId, provider: "signoz" });
                  setMessage("SigNoz workspace credentials removed — .env fallback will apply.");
                }}
              >
                Remove vault
              </button>
            ) : null}
          </div>
        </article>

        <article className="evx-dash__settings-card">
          <div className="evx-dash__org-integration-head">
            <p className="evx-dash__settings-label">{PROVIDER_LABELS.github}</p>
            {renderSourceBadge(byProvider.get("github"))}
          </div>
          <label className="evx-dash__org-field">
            <span>PAT token {byProvider.get("github")?.maskedSecrets.token ? `(${byProvider.get("github")?.maskedSecrets.token})` : ""}</span>
            <input
              type="password"
              placeholder="ghp_… — repo read scope"
              value={githubForm.token}
              onChange={(event) => setGithubForm((prev) => ({ ...prev, token: event.target.value }))}
            />
          </label>
          <div className="evx-dash__cause-actions">
            <button
              type="button"
              className="evx-dash__btn-primary"
              disabled={upsertGithub.isPending}
              onClick={async () => {
                await upsertGithub.mutateAsync({
                  organizationId,
                  token: githubForm.token || undefined,
                  webhookSecret: githubForm.webhookSecret || undefined,
                });
                setMessage("GitHub token saved to workspace vault.");
              }}
            >
              Save GitHub
            </button>
            <button type="button" className="evx-dash__btn-ghost" onClick={() => handleTest("github")}>
              Test
            </button>
            {byProvider.get("github")?.source === "organization" ? (
              <button
                type="button"
                className="evx-dash__btn-ghost"
                onClick={async () => {
                  await removeIntegration.mutateAsync({ organizationId, provider: "github" });
                  setMessage("GitHub workspace credentials removed.");
                }}
              >
                Remove vault
              </button>
            ) : null}
          </div>
        </article>

        <article className="evx-dash__settings-card">
          <div className="evx-dash__org-integration-head">
            <p className="evx-dash__settings-label">{PROVIDER_LABELS.slack}</p>
            {renderSourceBadge(byProvider.get("slack"))}
          </div>
          <label className="evx-dash__org-field">
            <span>Incoming webhook URL</span>
            <input
              type="url"
              placeholder="https://hooks.slack.com/services/…"
              value={slackForm.webhookUrl}
              onChange={(event) => setSlackForm({ webhookUrl: event.target.value })}
            />
          </label>
          <div className="evx-dash__cause-actions">
            <button
              type="button"
              className="evx-dash__btn-primary"
              disabled={upsertSlack.isPending}
              onClick={async () => {
                await upsertSlack.mutateAsync({
                  organizationId,
                  webhookUrl: slackForm.webhookUrl || undefined,
                });
                setMessage("Slack webhook saved to workspace vault.");
              }}
            >
              Save Slack
            </button>
            {byProvider.get("slack")?.source === "organization" ? (
              <button
                type="button"
                className="evx-dash__btn-ghost"
                onClick={async () => {
                  await removeIntegration.mutateAsync({ organizationId, provider: "slack" });
                  setMessage("Slack workspace credentials removed.");
                }}
              >
                Remove vault
              </button>
            ) : null}
          </div>
        </article>

        <article className="evx-dash__settings-card">
          <div className="evx-dash__org-integration-head">
            <p className="evx-dash__settings-label">{PROVIDER_LABELS.pagerduty}</p>
            {renderSourceBadge(byProvider.get("pagerduty"))}
          </div>
          <label className="evx-dash__org-field">
            <span>Routing key</span>
            <input
              type="password"
              placeholder="Events API v2 routing key"
              value={pagerDutyForm.routingKey}
              onChange={(event) => setPagerDutyForm({ routingKey: event.target.value })}
            />
          </label>
          <div className="evx-dash__cause-actions">
            <button
              type="button"
              className="evx-dash__btn-primary"
              disabled={upsertPagerDuty.isPending}
              onClick={async () => {
                await upsertPagerDuty.mutateAsync({
                  organizationId,
                  routingKey: pagerDutyForm.routingKey || undefined,
                });
                setMessage("PagerDuty routing key saved to workspace vault.");
              }}
            >
              Save PagerDuty
            </button>
            {byProvider.get("pagerduty")?.source === "organization" ? (
              <button
                type="button"
                className="evx-dash__btn-ghost"
                onClick={async () => {
                  await removeIntegration.mutateAsync({ organizationId, provider: "pagerduty" });
                  setMessage("PagerDuty workspace credentials removed.");
                }}
              >
                Remove vault
              </button>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}
