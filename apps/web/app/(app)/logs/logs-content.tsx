"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { trpc } from "~/trpc/client";

function isUuid(value: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export default function LogsPageContent() {
  const searchParams = useSearchParams();
  const investigationId = searchParams.get("investigation");
  const serviceFilter = searchParams.get("service") ?? "";

  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<"ALL" | "ERROR" | "WARN" | "INFO">("ALL");

  const signozStatus = trpc.telemetry.status.useQuery();
  const useCaseScope = isUuid(investigationId);

  const caseQuery = trpc.investigations.logs.useQuery(
    { id: investigationId ?? "" },
    { enabled: useCaseScope },
  );

  const liveQuery = trpc.telemetry.logs.useQuery(
    { serviceName: serviceFilter || undefined, range: "15m", limit: 50 },
    {
      enabled: signozStatus.data?.configured === true && !useCaseScope,
      refetchInterval: 5000,
    },
  );

  const activeQuery = useCaseScope ? caseQuery : liveQuery;

  const filtered = useMemo(() => {
    const rows = useCaseScope ? (caseQuery.data?.logs ?? []) : (liveQuery.data?.logs ?? []);

    return rows
      .filter((log) => {
        const severity = (log.severityText ?? "INFO").toUpperCase();
        if (level !== "ALL" && severity !== level) return false;
        if (query && !(log.body ?? "").toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      })
      .map((log, index) => ({
        id: `${log.timestamp}-${index}`,
        at: log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "—",
        level: (log.severityText ?? "INFO").toUpperCase(),
        service: log.serviceName ?? caseQuery.data?.service ?? serviceFilter ?? "unknown",
        message: log.body ?? "",
      }));
  }, [useCaseScope, caseQuery.data, liveQuery.data, serviceFilter, level, query]);

  return (
    <>
      <AppPageHeader kicker="⊙ SIGNAL STREAM" title="Logs">
        {useCaseScope ? (
          <Link href="/investigations" className="evx-dash__chip">
            Case linked
          </Link>
        ) : null}
        {!useCaseScope && signozStatus.data?.configured ? (
          <span className="evx-dash__chip">Live · 15m · refreshes 5s</span>
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
        {(serviceFilter || caseQuery.data?.service) ? (
          <span className="evx-dash__chip">{caseQuery.data?.service ?? serviceFilter}</span>
        ) : null}
      </div>

      <div className="evx-dash__table">
        {signozStatus.isLoading ? (
          <p className="evx-dash__empty">Checking SigNoz connection…</p>
        ) : !signozStatus.data?.configured ? (
          <p className="evx-dash__empty">
            SigNoz is not configured. Add SIGNOZ_CLOUD_URL and SIGNOZ_API_KEY in Settings to load live logs.
          </p>
        ) : activeQuery.isLoading ? (
          <p className="evx-dash__empty">Loading logs from SigNoz…</p>
        ) : filtered.length ? (
          filtered.map((log) => (
            <div key={log.id} className="evx-dash__row">
              <span className="evx-dash__row-at">{log.at}</span>
              <span className={`evx-dash__row-meta evx-dash__level-${log.level.toLowerCase()}`}>{log.level}</span>
              <span className="evx-dash__row-meta">{log.service}</span>
              <span>{log.message}</span>
            </div>
          ))
        ) : (
          <p className="evx-dash__empty">
            {useCaseScope
              ? "No logs in this investigation window from SigNoz."
              : "No logs in the last 15 minutes for the selected filters."}
          </p>
        )}
      </div>
    </>
  );
}
