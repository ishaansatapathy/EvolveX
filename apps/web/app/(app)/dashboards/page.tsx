"use client";

import Link from "next/link";
import { useState } from "react";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { trpc } from "~/trpc/client";

const RANGES = ["15m", "1h", "6h"] as const;
const INTEL_WINDOWS = [7, 30, 90] as const;

function formatLatency(ms: number | null) {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function formatRelative(iso: string) {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.round(deltaMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function DashboardsPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("1h");
  const [intelWindow, setIntelWindow] = useState<(typeof INTEL_WINDOWS)[number]>(30);

  const intelligenceQuery = trpc.telemetryIntelligence.dashboard.useQuery(
    { windowDays: intelWindow },
    { refetchInterval: 30000 },
  );

  const metricsQuery = trpc.telemetry.serviceMetrics.useQuery(
    { range },
    { refetchInterval: 15000 },
  );

  const intel = intelligenceQuery.data;
  const panels = metricsQuery.data ?? [];

  return (
    <>
      <AppPageHeader kicker="⊙ INVESTIGATION INTELLIGENCE" title="Dashboards">
        <select
          className="evx-dash__select"
          value={String(intelWindow)}
          onChange={(e) => setIntelWindow(Number(e.target.value) as (typeof INTEL_WINDOWS)[number])}
        >
          {INTEL_WINDOWS.map((days) => (
            <option key={days} value={days}>
              Intel · last {days}d
            </option>
          ))}
        </select>
        <select className="evx-dash__select" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
          {RANGES.map((r) => (
            <option key={r} value={r}>
              SigNoz · {r}
            </option>
          ))}
        </select>
      </AppPageHeader>

      <section className="evx-dash__settings-card evx-dash__intel-dashboard">
        <p className="evx-dash__settings-label">TELEMETRY INTELLIGENCE · #55</p>
        {intelligenceQuery.isLoading ? (
          <p className="evx-dash__stat-note">Loading investigation intelligence…</p>
        ) : intel ? (
          <>
            <div className="evx-dash__intel-head">
              <span className={`evx-dash__chip evx-dash__chip--ti evx-dash__chip--ti-${intel.intelligenceState}`}>
                {intel.intelligenceState} sampling state
              </span>
              <span className="evx-dash__stat-note">
                {intel.activeSamplingPolicies} active sampling policies · window {intel.windowDays}d
              </span>
            </div>

            <div className="evx-dash__intel-kpi-grid">
              <article className="evx-dash__metric-card">
                <p className="evx-dash__stat-label">Investigations</p>
                <p className="evx-dash__stat-value">{intel.totals.investigations}</p>
                <p className="evx-dash__stat-note">{intel.totals.open} open · {intel.totals.resolved} resolved</p>
              </article>
              <article className="evx-dash__metric-card">
                <p className="evx-dash__stat-label">Avg investigation time</p>
                <p className="evx-dash__stat-value">
                  {intel.avgInvestigationMinutes != null ? `${intel.avgInvestigationMinutes}m` : "—"}
                </p>
                <p className="evx-dash__stat-note">Resolved cases only</p>
              </article>
              <article className="evx-dash__metric-card">
                <p className="evx-dash__stat-label">Resolution rate</p>
                <p className="evx-dash__stat-value">{intel.resolutionRatePercent}%</p>
                <p className="evx-dash__stat-note">{intel.totals.failed} pipeline failed</p>
              </article>
              <article className="evx-dash__metric-card">
                <p className="evx-dash__stat-label">Sampling policies</p>
                <p className="evx-dash__stat-value">{intel.activeSamplingPolicies}</p>
                <p className="evx-dash__stat-note">Adaptive tail sampling active</p>
              </article>
            </div>

            <div className="evx-dash__intel-columns">
              <section>
                <p className="evx-dash__ti-label">Most incident-prone services</p>
                {intel.incidentProneServices.length === 0 ? (
                  <p className="evx-dash__stat-note">No service incidents in this window.</p>
                ) : (
                  <ol className="evx-dash__intel-list">
                    {intel.incidentProneServices.map((row) => (
                      <li key={row.service}>
                        <span className="evx-dash__blast-service">{row.service}</span>
                        <span className="evx-dash__chip">{row.incidentCount} cases</span>
                        {row.openCount > 0 ? (
                          <span className="evx-dash__chip evx-dash__chip--low">{row.openCount} open</span>
                        ) : null}
                        <span className="evx-dash__stat-note">{formatRelative(row.lastIncidentAt)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section>
                <p className="evx-dash__ti-label">Top alert categories</p>
                {intel.topAlertCategories.length === 0 ? (
                  <p className="evx-dash__stat-note">No alert taxonomy yet.</p>
                ) : (
                  <ol className="evx-dash__intel-list">
                    {intel.topAlertCategories.map((row) => (
                      <li key={`${row.alertName}-${row.primaryService ?? "any"}`}>
                        <span className="evx-dash__blast-service">{row.alertName}</span>
                        <span className="evx-dash__chip">{row.count}×</span>
                        {row.primaryService ? (
                          <span className="evx-dash__stat-note">{row.primaryService}</span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section>
                <p className="evx-dash__ti-label">Recurring incident signals</p>
                {intel.frequentRootCauseSignals.length === 0 ? (
                  <p className="evx-dash__stat-note">No recurring patterns yet.</p>
                ) : (
                  <ol className="evx-dash__intel-list">
                    {intel.frequentRootCauseSignals.map((row) => (
                      <li key={row.signal}>
                        <span>{row.signal}</span>
                        <span className="evx-dash__chip">{row.count}×</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>

            {intel.recentInvestigations.length > 0 ? (
              <section className="evx-dash__intel-recent">
                <p className="evx-dash__ti-label">Recent investigations</p>
                <ol className="evx-dash__intel-list">
                  {intel.recentInvestigations.map((row) => (
                    <li key={row.id}>
                      <Link href={`/investigations?id=${row.id}`} className="evx-dash__intel-link">
                        {row.shortId}
                      </Link>
                      <span>{row.title}</span>
                      <span className="evx-dash__chip">{row.caseStatus}</span>
                      <span className="evx-dash__stat-note">{formatRelative(row.createdAt)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </>
        ) : (
          <p className="evx-dash__stat-note">Intelligence dashboard unavailable.</p>
        )}
      </section>

      <section style={{ marginTop: "1.25rem" }}>
        <p className="evx-dash__case-section-label">SigNoz service metrics</p>
        {metricsQuery.isLoading ? (
          <p className="evx-dash__empty">Loading service metrics from SigNoz…</p>
        ) : metricsQuery.isError || panels.length === 0 ? (
          <section className="evx-dash__settings-card">
            <p className="evx-dash__settings-label">NO METRICS YET</p>
            <p className="evx-dash__settings-value">
              Service metrics appear here once SigNoz receives traces from your stack.
            </p>
            <div className="evx-dash__cause-actions" style={{ marginTop: "0.75rem" }}>
              <Link href="/settings" className="evx-dash__btn-primary">
                Configure SigNoz →
              </Link>
            </div>
          </section>
        ) : (
          <div className="evx-dash__metric-grid">
            {panels.map((panel) => (
              <article key={panel.serviceName} className="evx-dash__metric-card">
                <p className="evx-dash__stat-label">{panel.serviceName} p99</p>
                <p className="evx-dash__stat-value">{formatLatency(panel.p99Ms)}</p>
                <p className="evx-dash__stat-note">
                  {panel.healthy ? "healthy" : "degraded"} · range {panel.range}
                </p>
                <div className="evx-dash__spark" aria-hidden>
                  <span
                    className="evx-dash__spark-bar"
                    style={{
                      height: `${Math.min(100, Math.max(12, ((panel.p99Ms ?? 0) / 2000) * 100))}%`,
                    }}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="evx-dash__cause-actions" style={{ marginTop: "1rem" }}>
        <Link href="/investigations" className="evx-dash__btn-primary">
          View Active Incidents →
        </Link>
        <Link href="/logs" className="evx-dash__btn-ghost">
          Open Logs
        </Link>
      </div>
    </>
  );
}
