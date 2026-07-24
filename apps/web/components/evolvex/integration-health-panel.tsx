type IntegrationHealthItem = {
  id: string;
  label: string;
  category: "telemetry" | "ai" | "change" | "platform";
  status: "ready" | "partial" | "missing" | "unavailable";
  configured: boolean;
  authConfigured: boolean;
  connected: boolean | null;
  detail: string;
  webhookUrl: string | null;
  actionLabel: string | null;
};

type IntegrationHealthPanelProps = {
  readyCount: number;
  partialCount: number;
  missingCount: number;
  totalCount: number;
  summary: string;
  productionMode: boolean;
  defaultServiceName: string;
  cloudUrl: string | null;
  integrations: IntegrationHealthItem[];
  copiedId: string | null;
  testingId: string | null;
  onCopy: (id: string, value: string) => void;
  onTest: (id: string) => void;
};

const CATEGORY_LABELS: Record<IntegrationHealthItem["category"], string> = {
  telemetry: "Telemetry",
  ai: "AI",
  change: "Change intelligence",
  platform: "Platform",
};

const STATUS_LABELS: Record<IntegrationHealthItem["status"], string> = {
  ready: "Ready",
  partial: "Needs setup",
  missing: "Not configured",
  unavailable: "Unavailable",
};

function statusChipClass(status: IntegrationHealthItem["status"]) {
  if (status === "ready") return "st-collected";
  if (status === "partial") return "st-partial";
  if (status === "missing") return "st-missing";
  return "st-unavailable";
}

function groupIntegrations(integrations: IntegrationHealthItem[]) {
  const groups = new Map<IntegrationHealthItem["category"], IntegrationHealthItem[]>();
  for (const item of integrations) {
    const list = groups.get(item.category) ?? [];
    list.push(item);
    groups.set(item.category, list);
  }
  return groups;
}

export function IntegrationHealthPanel({
  readyCount,
  partialCount,
  missingCount,
  totalCount,
  summary,
  productionMode,
  defaultServiceName,
  cloudUrl,
  integrations,
  copiedId,
  testingId,
  onCopy,
  onTest,
}: IntegrationHealthPanelProps) {
  const readinessPercent = totalCount > 0 ? Math.round((readyCount / totalCount) * 100) : 0;
  const groups = groupIntegrations(integrations);

  return (
    <section className="evx-dash__integration-health">
      <article className="evx-dash__settings-card evx-dash__integration-summary">
        <p className="evx-dash__settings-label">INTEGRATION HEALTH</p>
        <div className="evx-dash__completeness-head">
          <p className="evx-dash__completeness-percent">{readinessPercent}%</p>
          <p className="evx-dash__stat-note">{summary}</p>
        </div>
        <div
          className="evx-dash__completeness-bar"
          role="progressbar"
          aria-valuenow={readinessPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="evx-dash__completeness-bar-fill" style={{ width: `${readinessPercent}%` }} />
        </div>
        <div className="evx-dash__integration-stats">
          <span className="evx-dash__chip evx-dash__chip--source st-collected">{readyCount} ready</span>
          {partialCount > 0 ? (
            <span className="evx-dash__chip evx-dash__chip--source st-partial">{partialCount} partial</span>
          ) : null}
          {missingCount > 0 ? (
            <span className="evx-dash__chip evx-dash__chip--source st-missing">{missingCount} missing</span>
          ) : null}
          <span className="evx-dash__chip">{productionMode ? "Production" : "Development"}</span>
          <span className="evx-dash__chip">Service: {defaultServiceName}</span>
          {cloudUrl ? <span className="evx-dash__chip">SigNoz connected</span> : null}
        </div>
      </article>

      {[...groups.entries()].map(([category, items]) => (
        <div key={category} className="evx-dash__integration-group">
          <p className="evx-dash__timeline-label">{CATEGORY_LABELS[category].toUpperCase()}</p>
          <div className="evx-dash__integration-grid">
            {items.map((item) => (
              <article key={item.id} className="evx-dash__settings-card evx-dash__integration-card">
                <div className="evx-dash__integration-card-head">
                  <p className="evx-dash__settings-label">{item.label.toUpperCase()}</p>
                  <span className={`evx-dash__chip evx-dash__chip--source ${statusChipClass(item.status)}`}>
                    {STATUS_LABELS[item.status]}
                  </span>
                </div>
                <p className="evx-dash__settings-value">{item.detail}</p>
                {item.webhookUrl ? (
                  <p className="evx-dash__stat-note" style={{ marginTop: "0.35rem" }}>
                    Webhook: {item.webhookUrl}
                  </p>
                ) : null}
                {item.connected === true ? (
                  <p className="evx-dash__stat-note" style={{ marginTop: "0.35rem" }}>
                    Live probe: connected
                  </p>
                ) : item.connected === false ? (
                  <p className="evx-dash__stat-note" style={{ marginTop: "0.35rem", color: "#ffb4a2" }}>
                    Live probe: failed
                  </p>
                ) : null}
                {!item.authConfigured && item.configured ? (
                  <p className="evx-dash__stat-note" style={{ marginTop: "0.35rem" }}>
                    Auth secret missing — webhook URL alone is not enough
                  </p>
                ) : null}
                <div className="evx-dash__cause-actions" style={{ marginTop: "0.75rem" }}>
                  {item.actionLabel?.startsWith("Test") ? (
                    <button
                      type="button"
                      className="evx-dash__btn-primary"
                      disabled={testingId === item.id}
                      onClick={() => onTest(item.id)}
                    >
                      {testingId === item.id ? "Testing…" : item.actionLabel}
                    </button>
                  ) : null}
                  {item.actionLabel?.startsWith("Copy") && item.webhookUrl ? (
                    <button
                      type="button"
                      className={item.actionLabel.startsWith("Test") ? "evx-dash__btn-ghost" : "evx-dash__btn-primary"}
                      onClick={() => onCopy(item.id, item.webhookUrl!)}
                    >
                      {copiedId === item.id ? "Copied!" : item.actionLabel}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
