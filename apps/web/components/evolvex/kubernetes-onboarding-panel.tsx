"use client";

import { useState } from "react";

import { trpc } from "~/trpc/client";

type KubernetesOnboardingPanelProps = {
  organizationId?: string;
  isOwner: boolean;
};

export function KubernetesOnboardingPanel({ organizationId, isOwner }: KubernetesOnboardingPanelProps) {
  const [clusterName, setClusterName] = useState("production");
  const [copied, setCopied] = useState<string | null>(null);
  const onboardingMutation = trpc.organizations.integrations.generateKubernetesOnboarding.useMutation();
  const collectorQuery = trpc.telemetryIntelligence.collectorConfig.useQuery(undefined, {
    enabled: Boolean(organizationId) && isOwner,
  });

  if (!isOwner) return null;

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  const plan = onboardingMutation.data;

  return (
    <section className="evx-dash__integration-health evx-dash__k8s-onboarding" style={{ marginTop: "1rem" }}>
      <div className="evx-dash__integration-health-head">
        <div>
          <p className="evx-dash__context-card-title">Connect Kubernetes (#29 / #30)</p>
          <p className="evx-dash__stat-note">
            Generate a workspace-scoped webhook secret and Helm install command. The chart deploys an event forwarder
            and OTel collector ConfigMap — not the Evolvex API.
          </p>
        </div>
      </div>

      <div className="evx-dash__settings-card" style={{ marginTop: "0.75rem" }}>
        <label className="evx-dash__org-field">
          <span>Cluster name</span>
          <input
            type="text"
            value={clusterName}
            onChange={(event) => setClusterName(event.target.value)}
            placeholder="production"
          />
        </label>
        <div className="evx-dash__cause-actions">
          <button
            type="button"
            className="evx-dash__btn-primary"
            disabled={!organizationId || onboardingMutation.isPending}
            onClick={() =>
              organizationId &&
              onboardingMutation.mutate({
                organizationId,
                clusterName,
                rotateSecret: Boolean(plan),
              })
            }
          >
            {onboardingMutation.isPending ? "Generating…" : plan ? "Regenerate Helm command" : "Connect Kubernetes"}
          </button>
          {collectorQuery.data ? (
            <button
              type="button"
              className="evx-dash__btn-ghost"
              onClick={() => void copy("collector", collectorQuery.data.yaml)}
            >
              {copied === "collector" ? "Copied!" : "Copy collector YAML (#31)"}
            </button>
          ) : null}
        </div>
      </div>

      {plan ? (
        <div className="evx-dash__settings-card evx-dash__k8s-plan" style={{ marginTop: "0.75rem" }}>
          <p className="evx-dash__settings-label">Helm install</p>
          <pre className="evx-dash__code-block">{plan.helmInstallCommand}</pre>
          <div className="evx-dash__cause-actions">
            <button type="button" className="evx-dash__btn-ghost" onClick={() => void copy("helm", plan.helmInstallCommand)}>
              {copied === "helm" ? "Copied!" : "Copy Helm command"}
            </button>
            <button type="button" className="evx-dash__btn-ghost" onClick={() => void copy("secret", plan.webhookSecret)}>
              {copied === "secret" ? "Copied!" : "Copy webhook secret"}
            </button>
          </div>
          <dl className="evx-dash__pipeline-cache-meta">
            <div>
              <dt>Webhook</dt>
              <dd>{plan.webhookUrl}</dd>
            </div>
            <div>
              <dt>Secret</dt>
              <dd>{plan.maskedWebhookSecret ?? "generated"}</dd>
            </div>
            <div>
              <dt>Collector URL</dt>
              <dd>{plan.collectorConfigUrl}</dd>
            </div>
          </dl>
          <ul className="evx-dash__k8s-notes">
            {plan.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
