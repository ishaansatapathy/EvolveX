"use client";

import Link from "next/link";
import { useState } from "react";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { SERVICES } from "~/lib/evolvex-demo-data";

export default function ServiceMapPage() {
  const [selected, setSelected] = useState(SERVICES[2]?.id ?? SERVICES[0]!.id);
  const active = SERVICES.find((s) => s.id === selected) ?? SERVICES[0]!;

  return (
    <>
      <AppPageHeader kicker="⊙ DEPENDENCY GRAPH" title="Service Map" />

      <div className="evx-dash__service-grid">
        {SERVICES.map((service) => (
          <button
            key={service.id}
            type="button"
            className={`evx-dash__service-card st-${service.status} ${selected === service.id ? "is-selected" : ""}`}
            onClick={() => setSelected(service.id)}
          >
            <p className="evx-dash__panel-label">{service.name}</p>
            <p className="evx-dash__stat-value" style={{ fontSize: "1.1rem" }}>
              {service.errorRate}%
            </p>
            <p className="evx-dash__stat-note">{service.requestsPerMin} req/min · {service.status}</p>
          </button>
        ))}
      </div>

      <section className="evx-dash__detail" style={{ marginTop: "1rem" }}>
        <p className="evx-dash__panel-label">
          SELECTED NODE — <span>{active.name}</span>
        </p>
        <p className="evx-dash__cause-text" style={{ color: "var(--evx-paper)" }}>
          Downstream dependencies: {active.deps.length ? active.deps.join(", ") : "none"}
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
    </>
  );
}
