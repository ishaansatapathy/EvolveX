"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { trpc } from "~/trpc/client";

type IntegrationSummary = {
  provider: "signoz" | "github" | "slack" | "pagerduty" | "jira" | "kubernetes" | "ebpf" | "feature_flag" | "cicd";
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
  baseUrl?: string;
  slackOAuthConfigured?: boolean;
};

const PROVIDER_LABELS: Record<IntegrationSummary["provider"], string> = {
  signoz: "SigNoz",
  github: "GitHub",
  slack: "Slack",
  pagerduty: "PagerDuty",
  jira: "Jira",
  kubernetes: "Kubernetes",
  ebpf: "eBPF / OBI",
  feature_flag: "Feature flags",
  cicd: "CI/CD",
};

export function OrganizationIntegrationsPanel({
  organizationId,
  organizationName,
  isOwner,
  baseUrl = "http://localhost:8000",
  slackOAuthConfigured = false,
}: OrganizationIntegrationsPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const [showManualSlackForm, setShowManualSlackForm] = useState(false);
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
  const generateSignozWebhook = trpc.organizations.integrations.generateSignozWebhookOnboarding.useMutation({
    onSuccess: async () => {
      await utils.organizations.integrations.list.invalidate();
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
  const upsertJira = trpc.organizations.integrations.upsertJira.useMutation({
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
  const jiraTest = trpc.organizations.integrations.testJira.useQuery(
    { organizationId },
    { enabled: false },
  );
  const slackTest = trpc.organizations.integrations.testSlack.useQuery(
    { organizationId },
    { enabled: false },
  );
  const pagerDutyTest = trpc.organizations.integrations.testPagerDuty.useQuery(
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
  const [githubForm, setGithubForm] = useState({ token: "", webhookSecret: "", repositoryFullName: "" });
  const [slackForm, setSlackForm] = useState({ webhookUrl: "" });
  const [pagerDutyForm, setPagerDutyForm] = useState({ routingKey: "" });
  const [jiraForm, setJiraForm] = useState({
    baseUrl: "",
    email: "",
    apiToken: "",
    projectKey: "",
    issueType: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedSignozField, setCopiedSignozField] = useState<string | null>(null);
  const [githubTesting, setGithubTesting] = useState(false);
  const [githubStatus, setGithubStatus] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  const githubWebhookUrl = `${baseUrl.replace(/\/+$/, "")}/webhooks/github`;
  const slackAuthorizeUrl = organizationId
    ? `${baseUrl.replace(/\/+$/, "")}/integrations/slack/authorize?organizationId=${organizationId}`
    : null;

  useEffect(() => {
    const slackStatus = searchParams.get("slack");
    if (!slackStatus) return;

    const slackMessage = searchParams.get("slack_message");
    if (slackStatus === "connected") {
      setMessageTone("success");
      setMessage(slackMessage ? `Slack connected — posting to ${slackMessage}.` : "Slack connected.");
      void utils.organizations.integrations.list.invalidate();
      void utils.integrations.health.invalidate();
    } else if (slackStatus === "error") {
      setMessageTone("error");
      setMessage(slackMessage ?? "Slack connection failed.");
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete("slack");
    params.delete("slack_message");
    const query = params.toString();
    router.replace(query ? `/settings?${query}` : "/settings", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const byProvider = useMemo(() => {
    const map = new Map<IntegrationSummary["provider"], IntegrationSummary>();
    for (const item of integrationsQuery.data ?? []) {
      map.set(item.provider, item);
    }
    return map;
  }, [integrationsQuery.data]);

  const githubItem = byProvider.get("github");

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

  async function handleTest(provider: "signoz" | "github" | "jira" | "slack" | "pagerduty") {
    if (provider === "github") setGithubTesting(true);
    try {
      const result = await (
        {
          signoz: signozTest,
          github: githubTest,
          jira: jiraTest,
          slack: slackTest,
          pagerduty: pagerDutyTest,
        }[provider].refetch()
      );
      const tone = result.data?.ok ? "success" : "error";
      const text = result.data?.message ?? "Connection test failed";
      setMessageTone(tone);
      setMessage(text);
      if (provider === "github") {
        setGithubStatus({ tone, message: text });
      }
    } finally {
      if (provider === "github") setGithubTesting(false);
    }
  }

  async function handleCopyGithubWebhook() {
    await navigator.clipboard.writeText(githubWebhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 1500);
  }

  async function handleCopySignozField(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedSignozField(label);
    setTimeout(() => setCopiedSignozField(null), 1500);
  }

  function notify(text: string, tone: "info" | "success" | "error" = "success") {
    setMessageTone(tone);
    setMessage(text);
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
        <p
          className={`evx-dash__integration-message evx-dash__integration-message--${messageTone}`}
          style={{ marginBottom: "0.75rem" }}
        >
          {message}
        </p>
      ) : null}

      <div className="evx-dash__org-integrations-grid">
        <article className="evx-dash__settings-card evx-dash__signoz-integration-card">
          <div className="evx-dash__org-integration-head">
            <p className="evx-dash__settings-label">{PROVIDER_LABELS.signoz}</p>
            {renderSourceBadge(byProvider.get("signoz"))}
          </div>

          <div
            className={
              byProvider.get("signoz")?.configured
                ? "evx-dash__signoz-integration-body"
                : "evx-dash__signoz-integration-body evx-dash__signoz-integration-body--single"
            }
          >
            <div className="evx-dash__signoz-integration-connect">
              <div className="evx-dash__signoz-connect-fields">
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
                  <span>
                    API key{" "}
                    {byProvider.get("signoz")?.maskedSecrets.apiKey
                      ? `(${byProvider.get("signoz")?.maskedSecrets.apiKey})`
                      : ""}
                  </span>
                  <input
                    type="password"
                    placeholder="Leave blank to keep existing"
                    value={signozForm.apiKey}
                    onChange={(event) => setSignozForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                  />
                </label>
                <label className="evx-dash__org-field evx-dash__signoz-connect-fields__full">
                  <span>Webhook secret</span>
                  <input
                    type="password"
                    placeholder="Optional — leave blank to keep existing"
                    value={signozForm.webhookSecret}
                    onChange={(event) => setSignozForm((prev) => ({ ...prev, webhookSecret: event.target.value }))}
                  />
                </label>
              </div>
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
                    setMessageTone("success");
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
            </div>

            {byProvider.get("signoz")?.configured ? (
              <div className="evx-dash__signoz-integration-webhook evx-dash__k8s-plan">
                <p className="evx-dash__settings-label">Alert webhook (multi-tenant)</p>
                <p className="evx-dash__stat-note" style={{ marginBottom: "0.5rem" }}>
                  Generate a workspace-scoped webhook password so SigNoz alerts route straight to this
                  workspace — no shared secret, no re-pointing <code>INVESTIGATION_OWNER_EMAIL</code> per
                  tenant.
                </p>
                <div className="evx-dash__cause-actions">
                  <button
                    type="button"
                    className="evx-dash__btn-primary"
                    disabled={!organizationId || generateSignozWebhook.isPending}
                    onClick={() =>
                      organizationId &&
                      generateSignozWebhook.mutate({
                        organizationId,
                        // First click reveals (or creates) the secret; subsequent clicks rotate it.
                        rotateSecret: Boolean(generateSignozWebhook.data),
                      })
                    }
                  >
                    {generateSignozWebhook.isPending
                      ? "Generating…"
                      : generateSignozWebhook.data
                        ? "Rotate webhook password"
                        : byProvider.get("signoz")?.maskedSecrets.webhookSecret
                          ? "Reveal webhook credentials"
                          : "Generate webhook credentials"}
                  </button>
                </div>

                {generateSignozWebhook.data ? (
                  <>
                    <dl className="evx-dash__pipeline-cache-meta evx-dash__webhook-creds-meta">
                      <div>
                        <dt>Webhook URL</dt>
                        <dd>{generateSignozWebhook.data.webhookUrl}</dd>
                      </div>
                      <div>
                        <dt>Basic auth username</dt>
                        <dd>{generateSignozWebhook.data.webhookUsername}</dd>
                      </div>
                      <div>
                        <dt>Basic auth password</dt>
                        <dd>{generateSignozWebhook.data.webhookSecret}</dd>
                      </div>
                    </dl>
                    <div className="evx-dash__cause-actions">
                      <button
                        type="button"
                        className="evx-dash__btn-ghost"
                        onClick={() => void handleCopySignozField("url", generateSignozWebhook.data!.webhookUrl)}
                      >
                        {copiedSignozField === "url" ? "Copied!" : "Copy URL"}
                      </button>
                      <button
                        type="button"
                        className="evx-dash__btn-ghost"
                        onClick={() =>
                          void handleCopySignozField("password", generateSignozWebhook.data!.webhookSecret)
                        }
                      >
                        {copiedSignozField === "password" ? "Copied!" : "Copy password"}
                      </button>
                    </div>
                    <p className="evx-dash__stat-note">
                      Paste these into SigNoz → Settings → Alerts → Notification Channels → add a Webhook
                      channel with Basic Auth using the URL, username, and password above.
                    </p>
                  </>
                ) : byProvider.get("signoz")?.maskedSecrets.webhookSecret ? (
                  <p className="evx-dash__stat-note" style={{ marginTop: "0.5rem" }}>
                    Password ({byProvider.get("signoz")?.maskedSecrets.webhookSecret}) already generated — click
                    Rotate to reveal a fresh one for SigNoz&apos;s notification channel.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </article>

        <article className="evx-dash__settings-card evx-dash__github-integration-card">
          <div className="evx-dash__org-integration-head">
            <p className="evx-dash__settings-label">{PROVIDER_LABELS.github}</p>
            {renderSourceBadge(githubItem)}
          </div>
          {githubItem?.source === "organization" ? (
            <p className="evx-dash__stat-note evx-dash__github-saved-note">
              Token saved in workspace vault
              {githubItem.maskedSecrets.token ? ` (${githubItem.maskedSecrets.token})` : ""}.
            </p>
          ) : null}
          {githubStatus ? (
            <p className={`evx-dash__integration-message evx-dash__integration-message--${githubStatus.tone}`}>
              {githubStatus.message}
            </p>
          ) : null}
          <p className="evx-dash__stat-note" style={{ marginBottom: "0.65rem" }}>
            No OAuth — paste a personal access token (PAT). Optionally register the deploy webhook automatically when
            you provide owner/repo + webhook secret.
          </p>
          <details className="evx-dash__github-setup-guide">
            <summary>How to create a GitHub PAT</summary>
            <ol className="evx-dash__github-setup-steps">
              <li>
                Open{" "}
                <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">
                  GitHub → Settings → Developer settings → Personal access tokens
                </a>
                .
              </li>
              <li>
                <strong>Classic token:</strong> enable <code>repo</code> (private repos) and <code>read:user</code>.
              </li>
              <li>
                <strong>Fine-grained token:</strong> grant read access to repositories you deploy from.
              </li>
              <li>Paste the token below and click <strong>Save GitHub</strong>, then <strong>Test token</strong>.</li>
              <li>
                Optional: enter <code>owner/repo</code> below — Evolvex registers the push/deploy webhook for you
                (#28).
              </li>
              <li>
                Manual fallback: register push webhook at <code>{githubWebhookUrl}</code> with content type{" "}
                <code>application/json</code> and the secret below.
              </li>
            </ol>
          </details>
          <label className="evx-dash__org-field">
            <span>
              PAT token{" "}
              {byProvider.get("github")?.maskedSecrets.token
                ? `(saved: ${byProvider.get("github")?.maskedSecrets.token})`
                : ""}
            </span>
            <input
              type="password"
              placeholder="ghp_… or github_pat_…"
              value={githubForm.token}
              onChange={(event) => setGithubForm((prev) => ({ ...prev, token: event.target.value }))}
              autoComplete="off"
            />
          </label>
          <label className="evx-dash__org-field">
            <span>
              Webhook secret{" "}
              {byProvider.get("github")?.maskedSecrets.webhookSecret
                ? `(saved: ${byProvider.get("github")?.maskedSecrets.webhookSecret})`
                : ""}
            </span>
            <input
              type="password"
              placeholder="Optional — for POST /webhooks/github verification"
              value={githubForm.webhookSecret}
              onChange={(event) => setGithubForm((prev) => ({ ...prev, webhookSecret: event.target.value }))}
              autoComplete="off"
            />
          </label>
          <label className="evx-dash__org-field">
            <span>
              Repository{" "}
              {typeof githubItem?.config.repositoryFullName === "string"
                ? `(saved: ${githubItem.config.repositoryFullName})`
                : ""}
            </span>
            <input
              type="text"
              placeholder="owner/repo (e.g. acme/payments-api)"
              value={
                githubForm.repositoryFullName ||
                (typeof githubItem?.config.repositoryFullName === "string"
                  ? githubItem.config.repositoryFullName
                  : "")
              }
              onChange={(event) =>
                setGithubForm((prev) => ({ ...prev, repositoryFullName: event.target.value }))
              }
              autoComplete="off"
            />
          </label>
          <p className="evx-dash__stat-note evx-dash__github-webhook-url">
            Deploy webhook URL: <code>{githubWebhookUrl}</code>
          </p>
          <div className="evx-dash__cause-actions">
            <button
              type="button"
              className="evx-dash__btn-primary"
              disabled={upsertGithub.isPending}
              onClick={async () => {
                try {
                  const result = await upsertGithub.mutateAsync({
                    organizationId,
                    token: githubForm.token || undefined,
                    webhookSecret: githubForm.webhookSecret || undefined,
                    repositoryFullName: githubForm.repositoryFullName || undefined,
                    registerWebhook: true,
                  });
                  setGithubForm((prev) => ({ ...prev, token: "" }));
                  setGithubStatus(null);
                  const webhookNote = result.webhookRegistration?.ok
                    ? ` ${result.webhookRegistration.message}`
                    : "";
                  notify(`GitHub credentials saved to workspace vault.${webhookNote}`);
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Failed to save GitHub credentials", "error");
                }
              }}
            >
              Save GitHub
            </button>
            <button
              type="button"
              className="evx-dash__btn-ghost"
              disabled={githubTesting}
              onClick={() => handleTest("github")}
            >
              {githubTesting ? "Testing…" : "Test token"}
            </button>
            <button type="button" className="evx-dash__btn-ghost" onClick={() => void handleCopyGithubWebhook()}>
              {copiedWebhook ? "Copied!" : "Copy webhook URL"}
            </button>
            {byProvider.get("github")?.source === "organization" ? (
              <button
                type="button"
                className="evx-dash__btn-ghost"
                onClick={async () => {
                  await removeIntegration.mutateAsync({ organizationId, provider: "github" });
                  notify("GitHub workspace credentials removed — .env fallback will apply.", "info");
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

          {byProvider.get("slack")?.configured && byProvider.get("slack")?.config.connectedVia === "oauth" ? (
            <p className="evx-dash__stat-note" style={{ marginBottom: "0.65rem" }}>
              Connected to <strong>{String(byProvider.get("slack")?.config.teamName ?? "a Slack workspace")}</strong>
              {typeof byProvider.get("slack")?.config.channel === "string"
                ? ` · posting to #${byProvider.get("slack")?.config.channel}`
                : ""}
              .
            </p>
          ) : (
            <p className="evx-dash__stat-note" style={{ marginBottom: "0.65rem" }}>
              One click — no webhook URL to find or copy. Evolvex posts investigation-ready and case-resolved
              notifications to the channel you pick during Slack&apos;s install screen.
            </p>
          )}

          <div className="evx-dash__cause-actions" style={{ marginBottom: showManualSlackForm ? "0.75rem" : 0 }}>
            {slackOAuthConfigured && slackAuthorizeUrl ? (
              <a href={slackAuthorizeUrl} className="evx-dash__btn-primary">
                {byProvider.get("slack")?.config.connectedVia === "oauth" ? "Reconnect Slack" : "Add to Slack"}
              </a>
            ) : null}
            {byProvider.get("slack")?.source === "organization" ? (
              <button
                type="button"
                className="evx-dash__btn-ghost"
                onClick={async () => {
                  await removeIntegration.mutateAsync({ organizationId, provider: "slack" });
                  setMessage("Slack workspace credentials removed.");
                }}
              >
                Disconnect
              </button>
            ) : null}
            <button
              type="button"
              className="evx-dash__btn-ghost"
              onClick={() => setShowManualSlackForm((prev) => !prev)}
            >
              {showManualSlackForm ? "Hide manual setup" : slackOAuthConfigured ? "Use a webhook URL instead" : "Manual setup"}
            </button>
          </div>

          {showManualSlackForm ? (
            <>
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
                  Save webhook URL
                </button>
              </div>
            </>
          ) : null}

          {byProvider.get("slack")?.configured ? (
            <div className="evx-dash__cause-actions" style={{ marginTop: "0.5rem" }}>
              <button type="button" className="evx-dash__btn-ghost" onClick={() => handleTest("slack")}>
                Send test message
              </button>
            </div>
          ) : null}
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
            {byProvider.get("pagerduty")?.configured ? (
              <button type="button" className="evx-dash__btn-ghost" onClick={() => handleTest("pagerduty")}>
                Test
              </button>
            ) : null}
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

        <article className="evx-dash__settings-card">
          <div className="evx-dash__org-integration-head">
            <p className="evx-dash__settings-label">{PROVIDER_LABELS.jira}</p>
            {renderSourceBadge(byProvider.get("jira"))}
          </div>
          <p className="evx-dash__stat-note" style={{ marginBottom: "0.65rem" }}>
            Create Jira issues from investigations with root cause, timeline, and fix context.
          </p>
          <label className="evx-dash__org-field">
            <span>Base URL</span>
            <input
              type="url"
              placeholder="https://your-org.atlassian.net"
              value={jiraForm.baseUrl || String(byProvider.get("jira")?.config.baseUrl ?? "")}
              onChange={(event) => setJiraForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
            />
          </label>
          <label className="evx-dash__org-field">
            <span>
              Email{" "}
              {byProvider.get("jira")?.maskedSecrets.email
                ? `(${byProvider.get("jira")?.maskedSecrets.email})`
                : ""}
            </span>
            <input
              type="email"
              placeholder="you@company.com"
              value={jiraForm.email}
              onChange={(event) => setJiraForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          </label>
          <label className="evx-dash__org-field">
            <span>
              API token{" "}
              {byProvider.get("jira")?.maskedSecrets.apiToken
                ? `(${byProvider.get("jira")?.maskedSecrets.apiToken})`
                : ""}
            </span>
            <input
              type="password"
              placeholder="Leave blank to keep existing"
              value={jiraForm.apiToken}
              onChange={(event) => setJiraForm((prev) => ({ ...prev, apiToken: event.target.value }))}
            />
          </label>
          <label className="evx-dash__org-field">
            <span>Project key</span>
            <input
              type="text"
              placeholder="ENG"
              value={jiraForm.projectKey || String(byProvider.get("jira")?.config.projectKey ?? "")}
              onChange={(event) => setJiraForm((prev) => ({ ...prev, projectKey: event.target.value }))}
            />
          </label>
          <label className="evx-dash__org-field">
            <span>Issue type</span>
            <input
              type="text"
              placeholder="Bug"
              value={jiraForm.issueType || String(byProvider.get("jira")?.config.issueType ?? "Bug")}
              onChange={(event) => setJiraForm((prev) => ({ ...prev, issueType: event.target.value }))}
            />
          </label>
          <div className="evx-dash__cause-actions">
            <button
              type="button"
              className="evx-dash__btn-primary"
              disabled={upsertJira.isPending}
              onClick={async () => {
                await upsertJira.mutateAsync({
                  organizationId,
                  baseUrl: jiraForm.baseUrl || String(byProvider.get("jira")?.config.baseUrl ?? ""),
                  email: jiraForm.email || undefined,
                  apiToken: jiraForm.apiToken || undefined,
                  projectKey: jiraForm.projectKey || String(byProvider.get("jira")?.config.projectKey ?? ""),
                  issueType: jiraForm.issueType || undefined,
                });
                setJiraForm((prev) => ({ ...prev, email: "", apiToken: "" }));
                notify("Jira credentials saved to workspace vault.");
              }}
            >
              Save Jira
            </button>
            <button type="button" className="evx-dash__btn-ghost" onClick={() => handleTest("jira")}>
              Test
            </button>
            {byProvider.get("jira")?.source === "organization" ? (
              <button
                type="button"
                className="evx-dash__btn-ghost"
                onClick={async () => {
                  await removeIntegration.mutateAsync({ organizationId, provider: "jira" });
                  notify("Jira workspace credentials removed — .env fallback will apply.", "info");
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
