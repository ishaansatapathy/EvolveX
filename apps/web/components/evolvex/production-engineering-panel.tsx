"use client";

import { trpc } from "~/trpc/client";

export function ProductionEngineeringPanel() {
  const benchmarksQuery = trpc.observability.benchmarks.useQuery({});
  const performanceQuery = trpc.observability.performance.useQuery({ windowDays: 30 });

  return (
    <section className="evx-dash__integration-health" style={{ marginTop: "1rem" }}>
      <div className="evx-dash__integration-health-head">
        <div>
          <p className="evx-dash__context-card-title">Production engineering (#41–#43)</p>
          <p className="evx-dash__stat-note">
            Benchmark core investigation paths and track operational metrics for this workspace.
          </p>
        </div>
      </div>

      <div className="evx-dash__org-integrations-grid">
        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">Benchmark suite</p>
          {benchmarksQuery.isLoading ? (
            <p className="evx-dash__stat-note">Running benchmarks…</p>
          ) : benchmarksQuery.data ? (
            <>
              <p className="evx-dash__stat-note">{benchmarksQuery.data.summary}</p>
              <ul className="evx-dash__benchmark-list">
                {benchmarksQuery.data.results.map((row) => (
                  <li key={row.name}>
                    <span>{row.name.replaceAll("_", " ")}</span>
                    <strong>{row.durationMs} ms</strong>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="evx-dash__stat-note">Benchmark data unavailable.</p>
          )}
        </article>

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">Performance metrics (30d)</p>
          {performanceQuery.isLoading ? (
            <p className="evx-dash__stat-note">Loading metrics…</p>
          ) : performanceQuery.data ? (
            <dl className="evx-dash__pipeline-cache-meta">
              <div>
                <dt>Investigations</dt>
                <dd>{performanceQuery.data.investigations.total}</dd>
              </div>
              <div>
                <dt>Ready</dt>
                <dd>{performanceQuery.data.investigations.ready}</dd>
              </div>
              <div>
                <dt>Avg build</dt>
                <dd>
                  {performanceQuery.data.investigations.avgBuildMinutes != null
                    ? `${performanceQuery.data.investigations.avgBuildMinutes} min`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>P95 build</dt>
                <dd>
                  {performanceQuery.data.investigations.p95BuildMinutes != null
                    ? `${performanceQuery.data.investigations.p95BuildMinutes} min`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Cache valid</dt>
                <dd>
                  {performanceQuery.data.cache.validRows}/{performanceQuery.data.cache.rows}
                </dd>
              </div>
              <div>
                <dt>Cache hit est.</dt>
                <dd>
                  {performanceQuery.data.cache.hitRateEstimatePercent != null
                    ? `${performanceQuery.data.cache.hitRateEstimatePercent}%`
                    : "—"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="evx-dash__stat-note">Performance metrics unavailable.</p>
          )}
        </article>
      </div>

      <p className="evx-dash__stat-note" style={{ marginTop: "0.75rem" }}>
        Architecture decisions are documented in <code>docs/adr/</code> (#43).
      </p>
    </section>
  );
}
