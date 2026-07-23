"use client";

import Link from "next/link";
import { useState } from "react";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { trpc } from "~/trpc/client";

const RANGES = ["15m", "1h", "6h"] as const;

function formatLatency(ms: number | null) {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

export default function DashboardsPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("1h");

  const metricsQuery = trpc.telemetry.serviceMetrics.useQuery(
    { range },
    { refetchInterval: 15000 },
  );

  const panels = metricsQuery.data ?? [];

  return (
    <>
      <AppPageHeader kicker="⊙ METRICS OVERVIEW" title="Dashboards">
        <select className="evx-dash__select" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
          {RANGES.map((r) => (
            <option key={r} value={r}>
              Last {r}
            </option>
          ))}
        </select>
      </AppPageHeader>

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
