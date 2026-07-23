"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { trpc } from "~/trpc/client";

function statusFromHealthy(healthy: boolean, latencyMs: number | null) {
  if (!healthy) return "critical" as const;
  if (latencyMs != null && latencyMs >= 500) return "degraded" as const;
  return "healthy" as const;
}

export default function ServiceMapPage() {
  const mapQuery = trpc.telemetry.serviceMap.useQuery(undefined, {
    refetchInterval: 15000,
  });

  const services = mapQuery.data?.services ?? [];
  const edges = mapQuery.data?.edges ?? [];

  const [selected, setSelected] = useState<string | null>(null);
  const activeName = selected ?? services[0]?.name ?? null;

  const active = useMemo(
    () => services.find((service) => service.name === activeName) ?? null,
    [services, activeName],
  );

  const downstream = useMemo(() => {
    if (!activeName) return [];
    return edges.filter((edge) => edge.source === activeName).map((edge) => edge.destination);
  }, [edges, activeName]);

  return (
    <>
      <AppPageHeader kicker="⊙ DEPENDENCY GRAPH" title="Service Map">
        {mapQuery.data ? <span className="evx-dash__chip">SigNoz · live</span> : null}
      </AppPageHeader>

      {mapQuery.isLoading ? (
        <p className="evx-dash__empty">Loading service map from SigNoz…</p>
      ) : mapQuery.isError || services.length === 0 ? (
        <section className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">NO SERVICE DATA</p>
          <p className="evx-dash__settings-value">Configure SigNoz and send traces to populate the dependency graph.</p>
          <div className="evx-dash__cause-actions" style={{ marginTop: "0.75rem" }}>
            <Link href="/settings" className="evx-dash__btn-primary">
              Open Settings →
            </Link>
          </div>
        </section>
      ) : (
        <>
          <div className="evx-dash__service-grid">
            {services.map((service) => {
              const status = statusFromHealthy(service.healthy, service.latencyMs);
              return (
                <button
                  key={service.name}
                  type="button"
                  className={`evx-dash__service-card st-${status} ${activeName === service.name ? "is-selected" : ""}`}
                  onClick={() => setSelected(service.name)}
                >
                  <p className="evx-dash__panel-label">{service.name}</p>
                  <p className="evx-dash__stat-value" style={{ fontSize: "1.1rem" }}>
                    {service.latencyMs != null ? `${service.latencyMs}ms` : "—"}
                  </p>
                  <p className="evx-dash__stat-note">p99 · {status}</p>
                </button>
              );
            })}
          </div>

          {active ? (
            <section className="evx-dash__detail" style={{ marginTop: "1rem" }}>
              <p className="evx-dash__panel-label">
                SELECTED NODE — <span>{active.name}</span>
              </p>
              <p className="evx-dash__cause-text" style={{ color: "var(--evx-paper)" }}>
                Downstream dependencies: {downstream.length ? downstream.join(", ") : "none detected in SigNoz"}
              </p>
              <div className="evx-dash__cause-actions">
                <Link href={`/logs?service=${active.name}`} className="evx-dash__btn-primary">
                  Open Logs →
                </Link>
                <Link href={`/traces?service=${active.name}`} className="evx-dash__btn-ghost">
                  Open Traces →
                </Link>
                <Link href="/investigations" className="evx-dash__btn-ghost">
                  Back to Investigations
                </Link>
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
