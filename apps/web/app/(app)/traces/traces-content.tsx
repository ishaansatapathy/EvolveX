"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { TRACES } from "~/lib/evolvex-demo-data";
import { trpc } from "~/trpc/client";

function isUuid(value: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export default function TracesPageContent() {
  const searchParams = useSearchParams();
  const investigationId = searchParams.get("investigation");
  const serviceFilter = searchParams.get("service") ?? "";
  const useLiveData = isUuid(investigationId);

  const [status, setStatus] = useState<"ALL" | "error" | "slow" | "ok">("ALL");

  const liveQuery = trpc.investigations.traces.useQuery(
    { id: investigationId ?? "" },
    { enabled: useLiveData },
  );

  const filtered = useMemo(() => {
    if (useLiveData) {
      return (liveQuery.data?.traces ?? [])
        .map((trace, index) => {
          const durationMs = trace.durationMs ?? 0;
          const traceStatus = trace.hasError ? "error" : durationMs >= 800 ? "slow" : "ok";
          return {
            id: trace.traceId ?? trace.spanId ?? String(index),
            name: trace.name ?? "span",
            service: trace.serviceName ?? liveQuery.data?.service ?? serviceFilter,
            durationMs,
            status: traceStatus as "error" | "slow" | "ok",
          };
        })
        .filter((trace) => status === "ALL" || trace.status === status);
    }

    return TRACES.filter((trace) => {
      if (serviceFilter && trace.service !== serviceFilter) return false;
      if (status !== "ALL" && trace.status !== status) return false;
      return true;
    });
  }, [useLiveData, liveQuery.data, serviceFilter, status]);

  return (
    <>
      <AppPageHeader kicker="⊙ DISTRIBUTED TRACES" title="Traces">
        {investigationId ? <span className="evx-dash__chip">Case linked</span> : null}
      </AppPageHeader>

      <div className="evx-dash__toolbar">
        <select className="evx-dash__select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="ALL">All statuses</option>
          <option value="error">Error</option>
          <option value="slow">Slow</option>
          <option value="ok">OK</option>
        </select>
        {(serviceFilter || liveQuery.data?.service) ? (
          <span className="evx-dash__chip">{liveQuery.data?.service ?? serviceFilter}</span>
        ) : null}
        {useLiveData ? <span className="evx-dash__chip">SigNoz window</span> : null}
        {investigationId ? (
          <Link href={`/logs?investigation=${investigationId}&service=${serviceFilter}`} className="evx-dash__chip">
            Open related logs →
          </Link>
        ) : null}
      </div>

      <div className="evx-dash__table">
        {liveQuery.isLoading ? (
          <p className="evx-dash__empty">Loading traces from SigNoz…</p>
        ) : filtered.length ? (
          filtered.map((trace) => (
            <div key={trace.id} className="evx-dash__row" style={{ gridTemplateColumns: "120px 120px 90px 1fr" }}>
              <span className="evx-dash__row-meta">{trace.name}</span>
              <span className="evx-dash__row-meta">{trace.service}</span>
              <span
                className={`evx-dash__row-meta evx-dash__level-${trace.status === "error" ? "error" : trace.status === "slow" ? "warn" : "info"}`}
              >
                {trace.durationMs}ms
              </span>
              <span>{trace.status.toUpperCase()}</span>
            </div>
          ))
        ) : (
          <p className="evx-dash__empty">
            {useLiveData ? "No traces in this investigation window from SigNoz." : "No traces match your filters."}
          </p>
        )}
      </div>
    </>
  );
}
