"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { LOGS } from "~/lib/evolvex-demo-data";
import { trpc } from "~/trpc/client";

function isUuid(value: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export default function LogsPageContent() {
  const searchParams = useSearchParams();
  const investigationId = searchParams.get("investigation");
  const serviceFilter = searchParams.get("service") ?? "";
  const useLiveData = isUuid(investigationId);

  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<"ALL" | "ERROR" | "WARN" | "INFO">("ALL");

  const liveQuery = trpc.investigations.logs.useQuery(
    { id: investigationId ?? "" },
    { enabled: useLiveData },
  );

  const filtered = useMemo(() => {
    if (useLiveData) {
      return (liveQuery.data?.logs ?? [])
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
          service: log.serviceName ?? liveQuery.data?.service ?? serviceFilter,
          message: log.body ?? "",
        }));
    }

    return LOGS.filter((log) => {
      if (serviceFilter && log.service !== serviceFilter) return false;
      if (level !== "ALL" && log.level !== level) return false;
      if (query && !log.message.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [useLiveData, liveQuery.data, serviceFilter, level, query]);

  return (
    <>
      <AppPageHeader kicker="⊙ SIGNAL STREAM" title="Logs">
        {investigationId ? (
          <Link href="/investigations" className="evx-dash__chip">
            Case linked
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
        {(serviceFilter || liveQuery.data?.service) ? (
          <span className="evx-dash__chip">{liveQuery.data?.service ?? serviceFilter}</span>
        ) : null}
        {useLiveData ? <span className="evx-dash__chip">SigNoz window</span> : null}
      </div>

      <div className="evx-dash__table">
        {liveQuery.isLoading ? (
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
            {useLiveData ? "No logs in this investigation window from SigNoz." : "No logs match your filters."}
          </p>
        )}
      </div>
    </>
  );
}
