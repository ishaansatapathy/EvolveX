"use client";

import { trpc } from "~/trpc/client";

const STATUS_LABEL: Record<"active" | "partial" | "optional", string> = {
  active: "Active",
  partial: "Partial",
  optional: "Optional",
};

export function IntegrationsEcosystemPanel() {
  const featuresQuery = trpc.integrations.ecosystemFeatures.useQuery({});

  return (
    <section className="evx-dash__integration-health" style={{ marginTop: "1rem" }}>
      <div className="evx-dash__integration-health-head">
        <div>
          <p className="evx-dash__context-card-title">Integrations ecosystem · Part 6</p>
          <p className="evx-dash__stat-note">
            Slack, PagerDuty, GitHub deploy correlation, K8s/eBPF/CI webhooks, search, filters, SDK, and plugins (#46–#60).
          </p>
        </div>
      </div>

      {featuresQuery.isLoading ? (
        <p className="evx-dash__stat-note">Loading ecosystem features…</p>
      ) : featuresQuery.data ? (
        <ul className="evx-dash__benchmark-list">
          {featuresQuery.data.map((feature) => (
            <li key={feature.id}>
              <span>
                {feature.id} · {feature.label}
              </span>
              <strong className={feature.status === "active" ? "evx-dash__health-ok" : undefined}>
                {STATUS_LABEL[feature.status]}
              </strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="evx-dash__stat-note">Ecosystem status unavailable.</p>
      )}

      {featuresQuery.data ? (
        <div style={{ marginTop: "0.75rem" }}>
          {featuresQuery.data.slice(0, 6).map((feature) => (
            <p key={`${feature.id}-detail`} className="evx-dash__stat-note">
              {feature.id}: {feature.detail}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
