"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { LOGS, getIncidentById } from "~/lib/evolvex-demo-data";

export default function LogsPageContent() {
  const searchParams = useSearchParams();
  const incidentId = searchParams.get("incident");
  const serviceFilter = searchParams.get("service") ?? "";
  const incident = getIncidentById(incidentId);

  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<"ALL" | "ERROR" | "WARN" | "INFO">("ALL");

  const filtered = useMemo(() => {
    return LOGS.filter((log) => {
      if (incidentId && log.incidentId !== incidentId) return false;
      if (serviceFilter && log.service !== serviceFilter) return false;
      if (level !== "ALL" && log.level !== level) return false;
      if (query && !log.message.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [incidentId, serviceFilter, level, query]);

  return (
    <>
      <AppPageHeader kicker="⊙ SIGNAL STREAM" title="Logs">
        {incident ? (
          <Link href="/investigations" className="evx-dash__chip">
            {incident.id}
          </Link>
        ) : null}
      </AppPageHeader>

      <div className="evx-dash__toolbar">
        <input
          className="evx-dash__input"
          placeholder="Search logs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="evx-dash__select" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
          <option value="ALL">All levels</option>
          <option value="ERROR">ERROR</option>
          <option value="WARN">WARN</option>
          <option value="INFO">INFO</option>
        </select>
        {serviceFilter ? <span className="evx-dash__chip">{serviceFilter}</span> : null}
      </div>

      <div className="evx-dash__table">
        {filtered.length ? (
          filtered.map((log) => (
            <div key={log.id} className="evx-dash__row">
              <span className="evx-dash__row-at">{log.at}</span>
              <span className={`evx-dash__row-meta evx-dash__level-${log.level.toLowerCase()}`}>{log.level}</span>
              <span className="evx-dash__row-meta">{log.service}</span>
              <span>{log.message}</span>
            </div>
          ))
        ) : (
          <p className="evx-dash__empty">No logs match your filters.</p>
        )}
      </div>
    </>
  );
}
