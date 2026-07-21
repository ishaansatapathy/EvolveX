"use client";

import Link from "next/link";
import { useState } from "react";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { METRIC_PANELS } from "~/lib/evolvex-demo-data";

const RANGES = ["15m", "1h", "6h", "24h", "7d"] as const;

export default function DashboardsPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("1h");
  const maxSeries = Math.max(...METRIC_PANELS.flatMap((p) => p.series));

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

      <div className="evx-dash__metric-grid">
        {METRIC_PANELS.map((panel) => (
          <article key={panel.id} className="evx-dash__metric-card">
            <p className="evx-dash__stat-label">{panel.title}</p>
            <p className="evx-dash__stat-value">{panel.value}</p>
            <p className="evx-dash__stat-note">
              {panel.delta} · range {range}
            </p>
            <div className="evx-dash__spark" aria-hidden>
              {panel.series.map((value, i) => (
                <span
                  key={`${panel.id}-${i}`}
                  className="evx-dash__spark-bar"
                  style={{ height: `${Math.max(12, (value / maxSeries) * 100)}%` }}
                />
              ))}
            </div>
          </article>
        ))}
      </div>

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
