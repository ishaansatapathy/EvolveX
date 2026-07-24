"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { trpc } from "~/trpc/client";

function isUuid(value: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function traceStatus(durationMs: number, hasError?: boolean) {
  if (hasError) return "error" as const;
  if (durationMs >= 800) return "slow" as const;
  return "ok" as const;
}

export default function TracesPageContent() {
  const searchParams = useSearchParams();
  const investigationId = searchParams.get("investigation");
  const serviceFilter = searchParams.get("service") ?? "";

  const [status, setStatus] = useState<"ALL" | "error" | "slow" | "ok">("ALL");

  const signozStatus = trpc.telemetry.status.useQuery();
  const useCaseScope = isUuid(investigationId);

  const caseMetaQuery = trpc.investigations.get.useQuery(
    { id: investigationId ?? "" },
    { enabled: useCaseScope },
  );

  const caseQuery = trpc.investigations.traces.useQuery(
    { id: investigationId ?? "" },
    { enabled: useCaseScope },
  );

  const liveQuery = trpc.telemetry.traces.useQuery(
    { serviceName: serviceFilter || undefined, range: "15m", limit: 50 },
    {
      enabled: signozStatus.data?.configured === true && !useCaseScope,
      refetchInterval: 5000,
    },
  );

  const liveStatsQuery = trpc.telemetry.liveStats.useQuery(
    { serviceName: serviceFilter || undefined, range: "15m" },
    {
      enabled: signozStatus.data?.configured === true && !useCaseScope,
      refetchInterval: 5000,
    },
  );

  const activeQuery = useCaseScope ? caseQuery : liveQuery;

  const filtered = useMemo(() => {
    const rows = useCaseScope ? (caseQuery.data?.traces ?? []) : (liveQuery.data?.traces ?? []);

    return rows
      .map((trace, index) => {
        const durationMs = trace.durationMs ?? 0;
        const rowStatus = traceStatus(durationMs, trace.hasError);
        return {
          id: trace.traceId ?? trace.spanId ?? String(index),
          name: trace.name ?? "span",
          service: trace.serviceName ?? caseQuery.data?.service ?? serviceFilter ?? "unknown",
          durationMs,
          status: rowStatus,
          timestamp: trace.timestamp,
        };
      })
      .filter((trace) => status === "ALL" || trace.status === status);
  }, [useCaseScope, caseQuery.data, liveQuery.data, serviceFilter, status]);

  const stats = liveStatsQuery.data;

  return (
    <>
      <AppPageHeader kicker="⊙ DISTRIBUTED TRACES" title="Traces">
        {useCaseScope && caseMetaQuery.data ? (
          <Link
            href={`/investigations?investigation=${caseMetaQuery.data.id}`}
            className="evx-dash__chip evx-dash__chip--back"
          >
            ← {caseMetaQuery.data.shortId}
          </Link>
        ) : null}
        {useCaseScope ? <span className="evx-dash__chip">Incident window</span> : null}
        {!useCaseScope && signozStatus.data?.configured ? (
          <span className="evx-dash__chip">Live · 15m · refreshes 5s</span>
        ) : null}
      </AppPageHeader>

      {!useCaseScope && stats ? (
        <section className="evx-dash__stats">
          <article className="evx-dash__stat">
            <p className="evx-dash__stat-label">LIVE SPANS</p>
            <p className="evx-dash__stat-value">{stats.total}</p>
            <p className="evx-dash__stat-note">Last 15 minutes from SigNoz</p>
          </article>
          <article className="evx-dash__stat">
            <p className="evx-dash__stat-label">EVOLVEX API</p>
            <p className="evx-dash__stat-value">{stats.evolvexApiCount}</p>
            <p className="evx-dash__stat-note">Self-instrumented traffic</p>
          </article>
          <article className="evx-dash__stat">
            <p className="evx-dash__stat-label">ERRORS / SLOW</p>
            <p className="evx-dash__stat-value">
              {stats.errors}/{stats.slow}
            </p>
            <p className="evx-dash__stat-note">Real span classification</p>
          </article>
        </section>
      ) : null}

      {!useCaseScope && stats && stats.byService.length > 0 ? (
        <div className="evx-dash__toolbar">
          {stats.byService.slice(0, 6).map((entry) => (
            <Link
              key={entry.service}
              href={`/traces?service=${encodeURIComponent(entry.service)}`}
              className="evx-dash__chip"
            >
              {entry.service} · {entry.count}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="evx-dash__toolbar">
        <select className="evx-dash__select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="ALL">All statuses</option>
          <option value="error">Error</option>
          <option value="slow">Slow</option>
          <option value="ok">OK</option>
        </select>
        {serviceFilter || caseQuery.data?.service ? (
          <span className="evx-dash__chip">{caseQuery.data?.service ?? serviceFilter}</span>
        ) : null}
        {investigationId ? (
          <Link
            href={`/logs?investigation=${investigationId}&service=${encodeURIComponent(serviceFilter || caseQuery.data?.service || "")}`}
            className="evx-dash__chip"
          >
            Open related logs →
          </Link>
        ) : null}
      </div>

      <div className="evx-dash__table">
        {signozStatus.isLoading ? (
          <p className="evx-dash__empty">Checking SigNoz connection…</p>
        ) : !signozStatus.data?.configured ? (
          <p className="evx-dash__empty">
            SigNoz is not configured. Add SIGNOZ_CLOUD_URL and SIGNOZ_API_KEY in Settings to load live traces.
          </p>
        ) : activeQuery.isLoading ? (
          <p className="evx-dash__empty">Loading traces from SigNoz…</p>
        ) : filtered.length ? (
          filtered.map((trace) => (
            <div key={trace.id} className="evx-dash__row evx-dash__row--traces">
              <span className="evx-dash__row-meta">{trace.name}</span>
              <span className="evx-dash__row-meta">{trace.service}</span>
              <span
                className={`evx-dash__row-meta evx-dash__level-${trace.status === "error" ? "error" : trace.status === "slow" ? "warn" : "info"}`}
              >
                {trace.durationMs}ms
              </span>
              <span className="evx-dash__row-meta">{trace.status.toUpperCase()}</span>
            </div>
          ))
        ) : (
          <p className="evx-dash__empty">
            {useCaseScope
              ? "No traces in this investigation window from SigNoz."
              : "No traces in the last 15 minutes. Browse the app or run pnpm signoz:loadgen to emit real telemetry."}
          </p>
        )}
      </div>
    </>
  );
}
