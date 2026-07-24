"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { useDebouncedValue } from "~/hooks/use-debounced-value";
import { trpc } from "~/trpc/client";

const MATCH_LABEL: Record<string, string> = {
  title: "Title",
  short_id: "Case ID",
  service: "Service",
  alert: "Alert",
  summary: "Summary",
  timeline: "Timeline",
};

function formatRelativeTime(iso: string) {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.round(deltaMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function SearchPageContent() {
  const [query, setQuery] = useState("");
  const [service, setService] = useState("");
  const [alertName, setAlertName] = useState("");
  const [severity, setSeverity] = useState("");
  const [caseStatus, setCaseStatus] = useState("");
  const [pipelineStatus, setPipelineStatus] = useState("");
  const [timelineKind, setTimelineKind] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const debouncedService = useDebouncedValue(service.trim(), 300);

  const filterInput = useMemo(
    () => ({
      service: debouncedService || undefined,
      alertName: alertName.trim() || undefined,
      severity: severity || undefined,
      caseStatus:
        caseStatus === "open" ||
        caseStatus === "investigating" ||
        caseStatus === "monitoring" ||
        caseStatus === "resolved"
          ? caseStatus
          : undefined,
      pipelineStatus:
        pipelineStatus === "building" || pipelineStatus === "ready" || pipelineStatus === "failed"
          ? pipelineStatus
          : undefined,
      timelineKind: timelineKind || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    [alertName, caseStatus, dateFrom, dateTo, debouncedService, pipelineStatus, severity, timelineKind],
  );

  const searchQuery = trpc.investigations.search.useQuery(
    { query: debouncedQuery || " ", ...filterInput, limit: 50 },
    { enabled: debouncedQuery.length > 0 },
  );

  const browseQuery = trpc.investigations.list.useQuery(
    { limit: 50, ...filterInput },
    { enabled: debouncedQuery.length === 0 },
  );

  const results = debouncedQuery.length > 0 ? (searchQuery.data ?? []) : (browseQuery.data ?? []);
  const loading = debouncedQuery.length > 0 ? searchQuery.isLoading : browseQuery.isLoading;

  return (
    <>
      <AppPageHeader
        kicker="⊙ INVESTIGATION SEARCH · #59"
        title="Search"
        subtitle="Full-text search across cases, services, alerts, and timeline evidence"
      />

      <section className="evx-dash__settings-card evx-search__panel">
        <label className="evx-search__hero">
          <span className="evx-dash__sr-only">Search investigations</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Redis timeout, OOMKilled, payments-svc, INV-46F90094…"
            className="evx-search__hero-input"
            autoFocus
          />
        </label>

        <div className="evx-search__filters">
          <input
            type="search"
            value={service}
            onChange={(event) => setService(event.target.value)}
            placeholder="Service"
            className="evx-dash__queue-filter-select evx-search__filter-input"
            aria-label="Filter by service"
          />
          <input
            type="search"
            value={alertName}
            onChange={(event) => setAlertName(event.target.value)}
            placeholder="Alert name"
            className="evx-dash__queue-filter-select evx-search__filter-input"
            aria-label="Filter by alert"
          />
          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
            className="evx-dash__queue-filter-select"
            aria-label="Severity"
          >
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            value={caseStatus}
            onChange={(event) => setCaseStatus(event.target.value)}
            className="evx-dash__queue-filter-select"
            aria-label="Case status"
          >
            <option value="">All case status</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="monitoring">Monitoring</option>
            <option value="resolved">Resolved</option>
          </select>
          <select
            value={pipelineStatus}
            onChange={(event) => setPipelineStatus(event.target.value)}
            className="evx-dash__queue-filter-select"
            aria-label="Pipeline status"
          >
            <option value="">All pipeline</option>
            <option value="building">Building</option>
            <option value="ready">Ready</option>
            <option value="failed">Failed</option>
          </select>
          <select
            value={timelineKind}
            onChange={(event) => setTimelineKind(event.target.value)}
            className="evx-dash__queue-filter-select"
            aria-label="Timeline signal type"
          >
            <option value="">Any signal</option>
            <option value="ALERT">Alert</option>
            <option value="DEPLOY">Deploy</option>
            <option value="LOG">Log</option>
            <option value="TRACE">Trace</option>
            <option value="CHANGE">Change</option>
            <option value="EBPF">eBPF</option>
            <option value="AI">AI</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="evx-dash__queue-filter-select evx-search__filter-input"
            aria-label="From date"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className="evx-dash__queue-filter-select evx-search__filter-input"
            aria-label="To date"
          />
        </div>

        <p className="evx-dash__stat-note evx-search__hint">
          {debouncedQuery.length > 0
            ? "Searching metadata + Postgres full-text timeline index (GIN)."
            : "Type to search, or browse with advanced filters (#60)."}
        </p>
      </section>

      <section className="evx-search__results">
        {loading ? (
          <p className="evx-dash__stat-note">Searching case files…</p>
        ) : results.length === 0 ? (
          <p className="evx-dash__stat-note">
            {debouncedQuery.length > 0 || Object.values(filterInput).some(Boolean)
              ? "No investigations match your query."
              : "No investigations yet."}
          </p>
        ) : (
          <>
            <p className="evx-dash__case-section-label">
              {results.length} result{results.length === 1 ? "" : "s"}
            </p>
            <ol className="evx-search__result-list">
              {results.map((item) => {
                const searchItem = "matchSources" in item ? item : null;
                return (
                  <li key={item.id} className="evx-search__result">
                    <Link href={`/investigations?investigation=${item.id}`} className="evx-search__result-link">
                      <div className="evx-search__result-head">
                        <span className="evx-dash__incident-id">{item.shortId}</span>
                        <span className="evx-dash__chip">{item.caseStatus}</span>
                        {item.severity ? <span className="evx-dash__chip">{item.severity}</span> : null}
                        <span className="evx-dash__stat-note">{formatRelativeTime(item.createdAt)}</span>
                      </div>
                      <p className="evx-search__result-title">{item.title}</p>
                      <p className="evx-dash__stat-note">
                        {searchItem?.primaryService ?? item.affectedServices[0] ?? "unknown service"}
                        {searchItem?.alertName ? ` · ${searchItem.alertName}` : ""}
                      </p>
                      {searchItem?.matchSnippet ? (
                        <p className="evx-search__snippet">…{searchItem.matchSnippet}…</p>
                      ) : null}
                      {searchItem?.matchSources?.length ? (
                        <div className="evx-search__match-sources">
                          {searchItem.matchSources.map((source) => (
                            <span key={source} className="evx-dash__chip evx-dash__chip--group">
                              {MATCH_LABEL[source] ?? source}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>
    </>
  );
}
