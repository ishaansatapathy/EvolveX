"use client";

import { useState } from "react";

import { trpc } from "~/trpc/client";

type SignalWebhooksPanelProps = {
  organizationId?: string;
  isOwner: boolean;
};

type SignalProvider = "ebpf" | "feature_flag" | "cicd";

const PROVIDER_ORDER: SignalProvider[] = ["ebpf", "feature_flag", "cicd"];

const PROVIDER_COPY: Record<SignalProvider, { title: string; blurb: string }> = {
  ebpf: {
    title: "eBPF / OBI",
    blurb: "Kernel-level network/latency signals from OBI, Cilium Hubble, or Pixie.",
  },
  feature_flag: {
    title: "Feature flags",
    blurb: "Correlate flag flips (LaunchDarkly, Flagsmith, OpenFeature) with incident timelines.",
  },
  cicd: {
    title: "CI/CD",
    blurb: "Correlate deploys/rollbacks (GitHub Actions, CircleCI, Jenkins, GitLab) with incidents.",
  },
};

function relativeTime(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.max(0, Math.round(deltaMs / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function SignalWebhooksPanel({ organizationId, isOwner }: SignalWebhooksPanelProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const integrationsQuery = trpc.organizations.integrations.list.useQuery(
    { organizationId },
    { enabled: Boolean(organizationId) && isOwner },
  );
  const generateMutation = trpc.organizations.integrations.generateSignalWebhook.useMutation({
    onSuccess: async () => {
      await utils.organizations.integrations.list.invalidate();
    },
  });
  const removeMutation = trpc.organizations.integrations.remove.useMutation({
    onSuccess: async () => {
      await utils.organizations.integrations.list.invalidate();
    },
  });

  if (!isOwner) return null;

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <section className="evx-dash__integration-health" style={{ marginTop: "1rem" }}>
      <div className="evx-dash__integration-health-head">
        <div>
          <p className="evx-dash__context-card-title">Connect signal webhooks</p>
          <p className="evx-dash__stat-note">
            Each source gets its own workspace-scoped secret — no shared global secret across tenants, and rotating
            one never breaks an in-flight agent/CI runner (24h dual-secret grace window).
          </p>
        </div>
      </div>

      <div className="evx-dash__org-integrations-grid" style={{ marginTop: "0.75rem" }}>
        {PROVIDER_ORDER.map((provider) => {
          const item = integrationsQuery.data?.find((entry) => entry.provider === provider);
          const lastEventAt = typeof item?.config.lastEventAt === "string" ? item.config.lastEventAt : null;
          const lastEventSummary =
            typeof item?.config.lastEventSummary === "string" ? item.config.lastEventSummary : null;
          const plan = generateMutation.data?.provider === provider ? generateMutation.data : null;
          const copy_ = PROVIDER_COPY[provider];
          const isPending = generateMutation.isPending && generateMutation.variables?.provider === provider;

          return (
            <article className="evx-dash__settings-card" key={provider}>
              <div className="evx-dash__org-integration-head">
                <p className="evx-dash__settings-label">{copy_.title}</p>
                {item?.configured ? (
                  <span className="evx-dash__chip st-collected">Workspace vault</span>
                ) : (
                  <span className="evx-dash__chip st-missing">Not connected</span>
                )}
              </div>
              <p className="evx-dash__stat-note" style={{ marginBottom: "0.5rem" }}>
                {copy_.blurb}
              </p>

              {item?.configured ? (
                <p
                  className={`evx-dash__integration-message evx-dash__integration-message--${lastEventAt ? "success" : "info"}`}
                >
                  {lastEventAt
                    ? `✅ Connected — last event ${relativeTime(lastEventAt)}${lastEventSummary ? ` (${lastEventSummary})` : ""}`
                    : "⏳ Waiting for the first event — send one from your source, then this updates automatically."}
                </p>
              ) : null}

              <div className="evx-dash__cause-actions">
                <button
                  type="button"
                  className="evx-dash__btn-primary"
                  disabled={!organizationId || isPending}
                  onClick={() =>
                    organizationId &&
                    generateMutation.mutate({
                      organizationId,
                      provider,
                      rotateSecret: Boolean(item?.configured),
                    })
                  }
                >
                  {isPending ? "Generating…" : item?.configured ? "Rotate secret" : "Connect"}
                </button>
                {item?.configured ? (
                  <button
                    type="button"
                    className="evx-dash__btn-ghost"
                    onClick={async () => {
                      if (!organizationId) return;
                      await removeMutation.mutateAsync({ organizationId, provider });
                    }}
                  >
                    Disconnect
                  </button>
                ) : null}
              </div>

              {plan ? (
                <div style={{ marginTop: "0.6rem" }}>
                  <pre className="evx-dash__code-block">{plan.curlExample}</pre>
                  <div className="evx-dash__cause-actions">
                    <button
                      type="button"
                      className="evx-dash__btn-ghost"
                      onClick={() => void copy(`${provider}-url`, plan.webhookUrl)}
                    >
                      {copied === `${provider}-url` ? "Copied!" : "Copy webhook URL"}
                    </button>
                    <button
                      type="button"
                      className="evx-dash__btn-ghost"
                      onClick={() => void copy(`${provider}-secret`, plan.webhookSecret)}
                    >
                      {copied === `${provider}-secret` ? "Copied!" : "Copy secret"}
                    </button>
                  </div>
                  <dl className="evx-dash__pipeline-cache-meta">
                    <div>
                      <dt>Header</dt>
                      <dd>{plan.headerName}</dd>
                    </div>
                    <div>
                      <dt>Secret</dt>
                      <dd>{plan.maskedWebhookSecret ?? "generated"}</dd>
                    </div>
                  </dl>
                  <p className="evx-dash__stat-note">{plan.docsHint}</p>
                </div>
              ) : item?.configured ? (
                <p className="evx-dash__stat-note" style={{ marginTop: "0.5rem" }}>
                  Secret{" "}
                  {typeof item.maskedSecrets.webhookSecret === "string" ? `(${item.maskedSecrets.webhookSecret}) ` : ""}
                  already generated — click Rotate to see a fresh curl example, or Disconnect to remove it.
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
