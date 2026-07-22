"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { trpc } from "~/trpc/client";

function formatRelativeTime(iso: string) {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.round(deltaMs / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function formatEventTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function mapUiStatus(status: "building" | "ready" | "failed") {
  if (status === "building") return "INVESTIGATING";
  if (status === "failed") return "OPEN";
  return "OPEN";
}

function mapSeverity(value: string | null | undefined) {
  const normalized = (value ?? "medium").toLowerCase();
  if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "medium";
}

export default function InvestigationsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const listQuery = trpc.investigations.list.useQuery(
    { limit: 50 },
    { refetchInterval: (query) => (query.state.data?.some((item) => item.status === "building") ? 3000 : false) },
  );

  const investigations = listQuery.data ?? [];
  const activeId = selectedId ?? investigations[0]?.id ?? null;

  const detailQuery = trpc.investigations.get.useQuery(
    { id: activeId ?? "" },
    { enabled: Boolean(activeId), refetchInterval: (query) => (query.state.data?.status === "building" ? 3000 : false) },
  );

  const timelineQuery = trpc.investigations.timeline.useQuery(
    { id: activeId ?? "" },
    { enabled: Boolean(activeId), refetchInterval: detailQuery.data?.status === "building" ? 3000 : false },
  );

  const stats = useMemo(() => {
    const open = investigations.length;
    const building = investigations.filter((item) => item.status === "building").length;
    const ready = investigations.filter((item) => item.status === "ready").length;
    return [
      { label: "ACTIVE CASES", value: String(open), note: "From SigNoz alerts" },
      { label: "BUILDING", value: String(building), note: "Collecting evidence" },
      { label: "READY", value: String(ready), note: "Timeline available" },
    ];
  }, [investigations]);

  const incident = detailQuery.data;
  const timeline = timelineQuery.data ?? [];
  const primaryService = incident?.affectedServices[0] ?? "unknown";

  function scrollToTimeline() {
    timelineRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (listQuery.isLoading) {
    return (
      <>
        <AppPageHeader kicker="⊙ ACTIVE CASE FILES" title="Investigations" />
        <p className="evx-dash__stat-note">Loading investigations…</p>
      </>
    );
  }

  if (investigations.length === 0) {
    return (
      <>
        <AppPageHeader kicker="⊙ ACTIVE CASE FILES" title="Investigations" />
        <section className="evx-dash__settings-card" style={{ marginTop: "1rem" }}>
          <p className="evx-dash__settings-label">NO CASES YET</p>
          <p className="evx-dash__settings-value">Connect SigNoz Cloud to start investigations</p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.75rem" }}>
            1. Add <code>SIGNOZ_CLOUD_URL</code> and <code>SIGNOZ_API_KEY</code> to your <code>.env</code>
            <br />
            2. Expose <code>POST /webhooks/signoz</code> via ngrok and set it in SigNoz Notification Channels
            <br />
            3. Fire a test alert — Evolvex will open a case file automatically
            <br />
            4. For tail latency: run <code>pnpm signoz:p99</code>, then create a SigNoz <strong>p99 latency</strong> alert (SigNoz computes percentiles — Evolvex investigates)
          </p>
          <div className="evx-dash__cause-actions" style={{ marginTop: "1rem" }}>
            <Link href="/settings" className="evx-dash__btn-primary">
              Check SigNoz setup →
            </Link>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <AppPageHeader kicker="⊙ ACTIVE CASE FILES" title="Investigations" />

      <section className="evx-dash__stats">
        {stats.map((stat) => (
          <article key={stat.label} className="evx-dash__stat">
            <p className="evx-dash__stat-label">{stat.label}</p>
            <p className="evx-dash__stat-value">{stat.value}</p>
            <p className="evx-dash__stat-note">{stat.note}</p>
          </article>
        ))}
      </section>

      <section className="evx-dash__grid">
        <div className="evx-dash__incidents">
          <p className="evx-dash__panel-label">INCIDENT QUEUE</p>
          {investigations.map((inc) => (
            <button
              key={inc.id}
              type="button"
              className={`evx-dash__incident sev-${mapSeverity(inc.severity)} ${activeId === inc.id ? "is-selected" : ""}`}
              onClick={() => setSelectedId(inc.id)}
            >
              <span className="evx-dash__incident-top">
                <span className="evx-dash__incident-id">{inc.shortId}</span>
                <span className={`evx-dash__incident-status st-${mapUiStatus(inc.status).toLowerCase()}`}>
                  {mapUiStatus(inc.status)}
                </span>
              </span>
              <span className="evx-dash__incident-title">{inc.title}</span>
              <span className="evx-dash__incident-meta">
                {inc.affectedServices[0] ?? "unknown"} · {formatRelativeTime(inc.createdAt)}
              </span>
            </button>
          ))}
        </div>

        <div className="evx-dash__detail">
          {incident ? (
            <>
              <p className="evx-dash__panel-label">
                CASE FILE — <span>{incident.shortId}</span>
              </p>

              <div className="evx-dash__cause">
                <p className="evx-dash__cause-kicker">✦ INVESTIGATION CONTEXT</p>
                <p className="evx-dash__cause-text">
                  {incident.context?.summary ??
                    (incident.status === "building"
                      ? "Collecting evidence from SigNoz…"
                      : incident.errorMessage ?? "No context generated yet.")}
                </p>
                <div className="evx-dash__cause-actions">
                  <button type="button" className="evx-dash__btn-primary" onClick={scrollToTimeline}>
                    Open Timeline
                  </button>
                  <Link href={`/logs?incident=${incident.shortId}&service=${primaryService}`} className="evx-dash__btn-ghost">
                    View Logs →
                  </Link>
                  <Link href={`/traces?incident=${incident.shortId}&service=${primaryService}`} className="evx-dash__btn-ghost">
                    View Traces →
                  </Link>
                </div>
              </div>

              <div className="evx-dash__timeline" ref={timelineRef}>
                <p className="evx-dash__timeline-label">EVIDENCE TIMELINE</p>
                {timeline.length === 0 ? (
                  <p className="evx-dash__stat-note">Timeline entries will appear as evidence is collected.</p>
                ) : (
                  timeline.map((ev) => (
                    <div key={ev.id} className="evx-dash__event">
                      <span className="evx-dash__event-at">{formatEventTime(ev.occurredAt)}</span>
                      <span className={`evx-dash__event-kind k-${ev.kind.toLowerCase()}`}>{ev.kind}</span>
                      <span className="evx-dash__event-text">
                        <strong>{ev.title}</strong> — {ev.detail}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <p className="evx-dash__stat-note">Select a case to view details.</p>
          )}
        </div>
      </section>
    </>
  );
}
