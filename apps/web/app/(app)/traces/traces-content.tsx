"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { TRACES, getIncidentById } from "~/lib/evolvex-demo-data";

export default function TracesPageContent() {
  const searchParams = useSearchParams();
  const incidentId = searchParams.get("incident");
  const serviceFilter = searchParams.get("service") ?? "";
  const incident = getIncidentById(incidentId);

  const [status, setStatus] = useState<"ALL" | "error" | "slow" | "ok">("ALL");

  const filtered = useMemo(() => {
    return TRACES.filter((trace) => {
      if (incidentId && trace.incidentId !== incidentId) return false;
      if (serviceFilter && trace.service !== serviceFilter) return false;
      if (status !== "ALL" && trace.status !== status) return false;
      return true;
    });
  }, [incidentId, serviceFilter, status]);

  return (
    <>
      <AppPageHeader kicker="⊙ DISTRIBUTED TRACES" title="Traces">
        {incident ? <span className="evx-dash__chip">{incident.id}</span> : null}
      </AppPageHeader>

      <div className="evx-dash__toolbar">
        <select className="evx-dash__select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="ALL">All statuses</option>
          <option value="error">Error</option>
          <option value="slow">Slow</option>
          <option value="ok">OK</option>
        </select>
        {serviceFilter ? <span className="evx-dash__chip">{serviceFilter}</span> : null}
        {incident ? (
          <Link href={`/logs?incident=${incident.id}&service=${incident.service}`} className="evx-dash__chip">
            Open related logs →
          </Link>
        ) : null}
      </div>

      <div className="evx-dash__table">
        {filtered.length ? (
          filtered.map((trace) => (
            <div key={trace.id} className="evx-dash__row" style={{ gridTemplateColumns: "120px 120px 90px 1fr" }}>
              <span className="evx-dash__row-meta">{trace.name}</span>
              <span className="evx-dash__row-meta">{trace.service}</span>
              <span
                className={`evx-dash__row-meta evx-dash__level-${trace.status === "error" ? "error" : trace.status === "slow" ? "warn" : "info"}`}
              >
                {trace.durationMs}ms
              </span>
              <span>
                {trace.status.toUpperCase()} · {trace.incidentId ?? "no incident link"}
              </span>
            </div>
          ))
        ) : (
          <p className="evx-dash__empty">No traces match your filters.</p>
        )}
      </div>
    </>
  );
}
