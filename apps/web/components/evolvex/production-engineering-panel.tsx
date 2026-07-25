"use client";

import { trpc } from "~/trpc/client";

const ADRS = [
  { id: "0001", title: "PostgreSQL investigation store", file: "0001-postgresql-investigation-store.md" },
  { id: "0002", title: "ClickHouse intelligence layer", file: "0002-clickhouse-intelligence-layer.md" },
  { id: "0003", title: "Evidence-first AI", file: "0003-evidence-first-ai.md" },
  { id: "0004", title: "Investigation pipeline cache", file: "0004-investigation-pipeline-cache.md" },
  { id: "0005", title: "Org integration vault", file: "0005-org-integration-vault.md" },
  { id: "0006", title: "Rate limiting & abuse protection", file: "0006-rate-limiting-abuse-protection.md" },
  { id: "0007", title: "Self-observability dogfooding", file: "0007-self-observability-dogfooding.md" },
  { id: "0008", title: "Production deploy automation", file: "0008-production-deploy-automation.md" },
];

export function ProductionEngineeringPanel() {
  const benchmarksQuery = trpc.observability.benchmarks.useQuery({});
  const performanceQuery = trpc.observability.performance.useQuery({ windowDays: 30 });
  const selfQuery = trpc.observability.self.useQuery({});
  const deepHealthQuery = trpc.observability.deepHealth.useQuery({});
  const deployCheckQuery = trpc.observability.deployCheck.useQuery({});
  const featuresQuery = trpc.observability.productionFeatures.useQuery({});

  return (
    <section className="evx-dash__integration-health" style={{ marginTop: "1rem" }}>
      <div className="evx-dash__integration-health-head">
        <div>
          <p className="evx-dash__context-card-title">Production engineering · Part 5</p>
          <p className="evx-dash__stat-note">
            Health, self-observability, benchmarks, deploy checks, and security posture for this Evolvex deployment.
          </p>
        </div>
      </div>

      {featuresQuery.data ? (
        <div className="evx-dash__cause-actions" style={{ marginBottom: "0.75rem", flexWrap: "wrap" }}>
          {featuresQuery.data.map((feature) => (
            <span key={feature.id} className="evx-dash__chip st-collected">
              {feature.id} {feature.label}: {feature.status}
            </span>
          ))}
        </div>
      ) : null}

      <div className="evx-dash__org-integrations-grid">
        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">Self-observability (#39 · #40)</p>
          {selfQuery.isLoading ? (
            <p className="evx-dash__stat-note">Loading OTel status…</p>
          ) : selfQuery.data ? (
            <>
              <p className="evx-dash__stat-note">
                Service <code>{selfQuery.data.serviceName}</code> · OTel{" "}
                {selfQuery.data.otel.enabled ? "exporting to SigNoz" : "disabled (set SIGNOZ_INGESTION_KEY)"}
              </p>
              <p className="evx-dash__stat-note">
                Rate limits: {selfQuery.data.rateLimiting.backend} · Security:{" "}
                {selfQuery.data.security.productionMode ? "production" : "development"}
              </p>
              {selfQuery.data.traceExplorerUrl ? (
                <a
                  href={selfQuery.data.traceExplorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="evx-dash__btn-ghost"
                  style={{ display: "inline-flex", marginTop: "0.5rem" }}
                >
                  Open Evolvex traces in SigNoz →
                </a>
              ) : null}
              {selfQuery.data.counterHighlights.length > 0 ? (
                <ul className="evx-dash__benchmark-list" style={{ marginTop: "0.65rem" }}>
                  {selfQuery.data.counterHighlights.map((row) => (
                    <li key={row.name}>
                      <span>{row.label}</span>
                      <strong>{row.value}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="evx-dash__stat-note" style={{ marginTop: "0.5rem" }}>
                  Runtime counters populate as investigations and webhooks flow through the API.
                </p>
              )}
            </>
          ) : (
            <p className="evx-dash__stat-note">Self-observability data unavailable.</p>
          )}
        </article>

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">Deep health (#37)</p>
          {deepHealthQuery.isLoading ? (
            <p className="evx-dash__stat-note">Probing dependencies…</p>
          ) : deepHealthQuery.data ? (
            <ul className="evx-dash__benchmark-list">
              {deepHealthQuery.data.checks.map((check) => (
                <li key={check.id}>
                  <span>{check.label}</span>
                  <strong className={check.ok ? "evx-dash__health-ok" : "evx-dash__health-bad"}>
                    {check.ok ? "ok" : check.message}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="evx-dash__stat-note">Deep health unavailable.</p>
          )}
        </article>

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">Benchmark suite (#41)</p>
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
          <p className="evx-dash__settings-label">Performance metrics (#42 · 30d)</p>
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

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">Deploy check (#45)</p>
          {deployCheckQuery.isLoading ? (
            <p className="evx-dash__stat-note">Running deploy preflight…</p>
          ) : deployCheckQuery.data ? (
            <>
              <p className="evx-dash__stat-note">{deployCheckQuery.data.summary}</p>
              {deployCheckQuery.data.smoke ? (
                <ul className="evx-dash__benchmark-list" style={{ marginTop: "0.5rem" }}>
                  {deployCheckQuery.data.smoke.checks.map((check) => (
                    <li key={check.name}>
                      <span>{check.name}</span>
                      <strong>{check.ok ? `${check.durationMs} ms` : check.message}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="evx-dash__stat-note" style={{ marginTop: "0.5rem" }}>
                  CLI: <code>pnpm deploy:check</code> · smoke: <code>pnpm deploy:smoke &lt;url&gt;</code>
                </p>
              )}
            </>
          ) : (
            <p className="evx-dash__stat-note">Deploy check unavailable.</p>
          )}
        </article>

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">Architecture decisions (#43)</p>
          <ul className="evx-dash__benchmark-list">
            {ADRS.map((adr) => (
              <li key={adr.id}>
                <span>
                  ADR-{adr.id} · {adr.title}
                </span>
              </li>
            ))}
          </ul>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.5rem" }}>
            Full text in repository <code>docs/adr/</code>. Security hardening (#44) uses Helmet, JWT rotation,
            webhook HMAC, Zod validation, and encrypted org secrets.
          </p>
        </article>
      </div>
    </section>
  );
}
