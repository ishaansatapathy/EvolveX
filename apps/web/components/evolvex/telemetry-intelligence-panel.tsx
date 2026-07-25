"use client";

import { trpc } from "~/trpc/client";

type RuntimeInsightsView = {
  enabled: true;
  serviceName: string;
  windowMinutes: number;
  source: "materialized_view" | "native_query" | "signoz_api";
  materializedViewsAvailable: boolean;
  latencySummary: {
    requests: number;
    errors: number;
    p99Ms: number | null;
  } | null;
  topFailingEndpoints: Array<{
    endpoint: string;
    errorCount: number;
    p99Ms: number | null;
  }>;
  queryElapsedMs: number | null;
};

type TelemetryIntelligenceView = {
  version: number;
  processedAt: string;
  intelligenceState: "normal" | "elevated" | "incident" | "change_boost";
  alertEnrichment?: {
    alertName: string;
    serviceNames: string[];
    severity: string | null;
    recentDeployCount: number;
    enrichmentNotes: string[];
    similarAlerts: Array<{
      shortId: string;
      title: string;
      matchReason: string;
    }>;
  } | null;
  samplingPolicies: Array<{
    serviceName: string;
    mode: string;
    sampleRate: number;
    reason: string;
  }>;
  collectorConfigHint?: string;
  runtimeInsights?: RuntimeInsightsView | null;
  clickhouseInsights?: RuntimeInsightsView | null;
};

function insightSourceLabel(source: RuntimeInsightsView["source"]) {
  switch (source) {
    case "materialized_view":
      return "ClickHouse materialized views";
    case "native_query":
      return "ClickHouse native queries";
    case "signoz_api":
      return "SigNoz Cloud API";
  }
}

type TelemetryIntelligencePanelProps = {
  data: TelemetryIntelligenceView;
  investigationId?: string | null;
};

function formatSampleRate(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

function stateLabel(state: TelemetryIntelligenceView["intelligenceState"]) {
  switch (state) {
    case "incident":
      return "Incident — 100% trace capture";
    case "change_boost":
      return "Change boost — deploy window sampling";
    case "elevated":
      return "Elevated — tail sampling boosted";
    default:
      return "Normal — baseline sampling";
  }
}

export function TelemetryIntelligencePanel({ data, investigationId }: TelemetryIntelligencePanelProps) {
  const enrichment = data.alertEnrichment;
  const liveInsightsQuery = trpc.telemetryIntelligence.insightsForInvestigation.useQuery(
    { investigationId: investigationId ?? "", windowMinutes: 15 },
    { enabled: Boolean(investigationId), staleTime: 60_000 },
  );
  const runtimeInsights =
    liveInsightsQuery.data ?? data.runtimeInsights ?? data.clickhouseInsights ?? null;
  const collectorUrl =
    data.collectorConfigHint ??
    (typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:8000/telemetry-intelligence/collector-config`
      : "/telemetry-intelligence/collector-config");

  return (
    <section className="evx-dash__context-card evx-dash__ti-card">
      <p className="evx-dash__context-card-title">Telemetry intelligence · Part 1</p>
      <div className="evx-dash__ti-head">
        <span className={`evx-dash__chip evx-dash__chip--ti evx-dash__chip--ti-${data.intelligenceState}`}>
          {stateLabel(data.intelligenceState)}
        </span>
        <span className="evx-dash__stat-note">Processed {new Date(data.processedAt).toLocaleString()}</span>
      </div>

      {data.samplingPolicies.length > 0 ? (
        <div className="evx-dash__ti-block">
          <p className="evx-dash__ti-label">Adaptive tail sampling (#1)</p>
          <ul className="evx-dash__ti-policy-list">
            {data.samplingPolicies.slice(0, 6).map((policy) => (
              <li key={`${policy.serviceName}-${policy.mode}`} className="evx-dash__ti-policy">
                <span className="evx-dash__blast-service">{policy.serviceName}</span>
                <span className="evx-dash__chip">{formatSampleRate(policy.sampleRate)}</span>
                <span className="evx-dash__chip">{policy.mode}</span>
                <span className="evx-dash__stat-note">{policy.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {enrichment ? (
        <div className="evx-dash__ti-block">
          <p className="evx-dash__ti-label">Alert enrichment (#3)</p>
          <p className="evx-dash__stat-note">
            {enrichment.alertName}
            {enrichment.severity ? ` · ${enrichment.severity}` : ""}
            {enrichment.recentDeployCount > 0 ? ` · ${enrichment.recentDeployCount} recent deploy(s)` : ""}
          </p>
          {enrichment.enrichmentNotes.length > 0 ? (
            <ul className="evx-dash__ti-notes">
              {enrichment.enrichmentNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          {enrichment.similarAlerts.length > 0 ? (
            <ul className="evx-dash__ti-similar">
              {enrichment.similarAlerts.map((item) => (
                <li key={item.shortId}>
                  <span className="evx-dash__chip">{item.shortId}</span> {item.title}
                  <span className="evx-dash__stat-note"> · {item.matchReason}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {runtimeInsights ? (
        <div className="evx-dash__ti-block">
          <p className="evx-dash__ti-label">Runtime intelligence (#4 · #5)</p>
          <p className="evx-dash__stat-note">
            {runtimeInsights.serviceName} · {runtimeInsights.windowMinutes}m window ·{" "}
            {insightSourceLabel(runtimeInsights.source)}
            {runtimeInsights.queryElapsedMs != null ? ` · ${runtimeInsights.queryElapsedMs}ms` : ""}
          </p>
          {runtimeInsights.latencySummary ? (
            <p className="evx-dash__stat-note">
              {runtimeInsights.latencySummary.requests} requests · {runtimeInsights.latencySummary.errors} errors · p99{" "}
              {runtimeInsights.latencySummary.p99Ms != null
                ? `${Math.round(runtimeInsights.latencySummary.p99Ms)}ms`
                : "—"}
            </p>
          ) : null}
          {runtimeInsights.topFailingEndpoints.length > 0 ? (
            <ol className="evx-dash__ti-policy-list">
              {runtimeInsights.topFailingEndpoints.map((row) => (
                <li key={row.endpoint} className="evx-dash__ti-policy">
                  <span className="evx-dash__blast-service">{row.endpoint}</span>
                  <span className="evx-dash__chip">{row.errorCount} errors</span>
                  {row.p99Ms != null ? (
                    <span className="evx-dash__chip">p99 {Math.round(row.p99Ms)}ms</span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="evx-dash__stat-note">No failing endpoints in runtime window.</p>
          )}
        </div>
      ) : liveInsightsQuery.isLoading ? (
        <p className="evx-dash__stat-note">Querying runtime intelligence…</p>
      ) : null}

      <div className="evx-dash__ti-foot">
        <a href={collectorUrl} target="_blank" rel="noreferrer" className="evx-dash__btn-ghost">
          OTel collector config (#2)
        </a>
      </div>
    </section>
  );
}
