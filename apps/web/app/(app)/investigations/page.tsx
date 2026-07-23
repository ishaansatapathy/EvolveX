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

function formatChangeEvent(type: string, metadata: Record<string, unknown>) {
  if (type === "commit" || type === "deployment") {
    const sha = typeof metadata.sha === "string" ? metadata.sha : null;
    const repo = typeof metadata.repo === "string" ? metadata.repo : null;
    if (repo && sha) return `${repo}@${sha}`;
  }
  return type;
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
  const activeListItem = investigations.find((item) => item.id === activeId);

  const contextQuery = trpc.investigations.context.useQuery(
    { id: activeId ?? "" },
    {
      enabled: Boolean(activeId),
      refetchInterval: (query) => (query.state.data?.investigation.status === "building" ? 3000 : false),
    },
  );

  const notesQuery = trpc.investigations.notes.useQuery(
    { investigationId: activeId ?? "" },
    { enabled: Boolean(activeId) },
  );

  const createNoteMutation = trpc.investigations.createNote.useMutation({
    onSuccess: () => {
      void notesQuery.refetch();
      setNoteDraft("");
    },
  });

  const regenerateSummaryMutation = trpc.investigations.regenerateSummary.useMutation({
    onSuccess: () => {
      void contextQuery.refetch();
    },
  });

  const [noteDraft, setNoteDraft] = useState("");

  const osContext = contextQuery.data;
  const timeline = osContext?.timeline ?? [];
  const primaryService =
    osContext?.investigation.primaryService ?? activeListItem?.affectedServices[0] ?? "unknown";

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

  const summaryText =
    osContext?.investigation.summary ??
    (osContext?.investigation.status === "building"
      ? "Collecting evidence from SigNoz…"
      : "No context generated yet.");

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
          {contextQuery.isLoading && !osContext ? (
            <p className="evx-dash__stat-note">Loading case context from Postgres…</p>
          ) : osContext && activeListItem ? (
            <>
              <p className="evx-dash__panel-label">
                CASE FILE — <span>{activeListItem.shortId}</span>
                {osContext.investigation.incidentId ? (
                  <span style={{ marginLeft: "0.5rem", opacity: 0.6 }}>· {osContext.investigation.incidentId}</span>
                ) : null}
              </p>

              <div className="evx-dash__cause">
                <p className="evx-dash__cause-kicker">✦ INVESTIGATION CONTEXT</p>
                <p className="evx-dash__cause-text">{summaryText}</p>
                <div className="evx-dash__cause-actions">
                  <button type="button" className="evx-dash__btn-primary" onClick={scrollToTimeline}>
                    Open Timeline
                  </button>
                  <Link href={`/logs?investigation=${activeListItem.id}&service=${primaryService}`} className="evx-dash__btn-ghost">
                    View Logs →
                  </Link>
                  <Link href={`/traces?investigation=${activeListItem.id}&service=${primaryService}`} className="evx-dash__btn-ghost">
                    View Traces →
                  </Link>
                </div>
              </div>

              {osContext.llmSummary ? (
                <section className="evx-dash__cause" style={{ transform: "rotate(0.4deg)" }}>
                  <p className="evx-dash__cause-kicker">✦ AI ROOT CAUSE · OPENAI</p>
                  <div
                    className="evx-dash__cause-text"
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    {osContext.llmSummary.markdown}
                  </div>
                  <p className="evx-dash__stat-note" style={{ marginTop: "0.5rem", color: "rgba(17,17,17,0.55)" }}>
                    Generated {formatRelativeTime(osContext.llmSummary.generatedAt)}
                  </p>
                </section>
              ) : osContext.investigation.status === "ready" ? (
                <section className="evx-dash__context-card">
                  <p className="evx-dash__context-card-title">AI SUMMARY</p>
                  <p className="evx-dash__stat-note">
                    No LLM summary yet. Configure OPENAI_API_KEY and regenerate from collected evidence.
                  </p>
                  <button
                    type="button"
                    className="evx-dash__btn-primary"
                    style={{ marginTop: "0.6rem" }}
                    disabled={regenerateSummaryMutation.isPending}
                    onClick={() => activeId && regenerateSummaryMutation.mutate({ id: activeId })}
                  >
                    {regenerateSummaryMutation.isPending ? "Generating…" : "Generate summary →"}
                  </button>
                </section>
              ) : null}

              {osContext.investigation.status === "ready" && osContext.llmSummary ? (
                <button
                  type="button"
                  className="evx-dash__btn-ghost"
                  style={{ width: "fit-content", color: "var(--evx-paper)", borderColor: "rgba(240,240,235,0.35)" }}
                  disabled={regenerateSummaryMutation.isPending}
                  onClick={() => activeId && regenerateSummaryMutation.mutate({ id: activeId })}
                >
                  Regenerate AI summary
                </button>
              ) : null}

              <section className="evx-dash__context-card">
                <p className="evx-dash__context-card-title">ENGINEER NOTES</p>
                {notesQuery.data?.length ? (
                  <div className="evx-dash__table" style={{ marginBottom: "0.75rem" }}>
                    {notesQuery.data.map((note) => (
                      <div key={note.id} className="evx-dash__row" style={{ gridTemplateColumns: "1fr 72px" }}>
                        <span className="evx-dash__event-text">{note.body}</span>
                        <span className="evx-dash__event-at">{formatRelativeTime(note.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="evx-dash__stat-note" style={{ marginBottom: "0.75rem" }}>
                    No notes yet. Add context for your team.
                  </p>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!activeId || !noteDraft.trim()) return;
                    createNoteMutation.mutate({ investigationId: activeId, body: noteDraft.trim() });
                  }}
                  className="evx-dash__toolbar"
                >
                  <input
                    className="evx-dash__input"
                    style={{ flex: 1 }}
                    placeholder="Looks related to Redis pool…"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                  />
                  <button type="submit" className="evx-dash__btn-primary" disabled={createNoteMutation.isPending}>
                    Add note
                  </button>
                </form>
              </section>

              <div className="evx-dash__timeline" ref={timelineRef}>
                <p className="evx-dash__timeline-label">EVIDENCE TIMELINE · POSTGRES</p>
                {timeline.length === 0 ? (
                  <p className="evx-dash__stat-note">Timeline entries will appear as evidence is collected.</p>
                ) : (
                  timeline.map((ev) => (
                    <div key={ev.id} className="evx-dash__event">
                      <span className="evx-dash__event-at">{formatEventTime(ev.occurredAt)}</span>
                      <span className={`evx-dash__event-kind k-${ev.kind.toLowerCase()}`}>{ev.kind}</span>
                      <span className="evx-dash__event-text">
                        <strong>{ev.title}</strong> — {ev.detail}
                        {ev.source ? <span style={{ opacity: 0.55 }}> · {ev.source}</span> : null}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="evx-dash__context-grid">
                <section className="evx-dash__context-card">
                  <p className="evx-dash__context-card-title">RUNTIME SIGNALS · SIGNOZ</p>
                  {osContext.runtimeSignals.length === 0 ? (
                    <p className="evx-dash__stat-note">No runtime signals stored yet.</p>
                  ) : (
                    <div className="evx-dash__table">
                      {osContext.runtimeSignals.slice(0, 6).map((signal) => (
                        <div key={signal.id} className="evx-dash__row" style={{ gridTemplateColumns: "72px 1fr 72px" }}>
                          <span className="evx-dash__chip">{signal.metric ?? "trace"}</span>
                          <span className="evx-dash__event-text">
                            {signal.service ?? primaryService}
                            {signal.traceId ? ` · ${signal.traceId.slice(0, 12)}…` : ""}
                          </span>
                          <span className="evx-dash__event-at">{signal.latencyMs ? `${signal.latencyMs}ms` : "—"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="evx-dash__context-card">
                  <p className="evx-dash__context-card-title">CHANGE EVENTS · GITHUB / K8S</p>
                  {osContext.changeEvents.length === 0 ? (
                    <p className="evx-dash__stat-note">No deploy/commit events correlated yet.</p>
                  ) : (
                    <div className="evx-dash__table">
                      {osContext.changeEvents.map((event) => (
                        <div key={event.id} className="evx-dash__row" style={{ gridTemplateColumns: "72px 1fr 64px" }}>
                          <span className="evx-dash__chip">{event.type}</span>
                          <span className="evx-dash__event-text">
                            {formatChangeEvent(event.type, event.metadata)}
                            {event.author ? ` · ${event.author}` : ""}
                          </span>
                          <span className="evx-dash__event-at">{formatEventTime(event.occurredAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              {osContext.dependencies.nodes.length > 0 ? (
                <section className="evx-dash__context-section">
                  <p className="evx-dash__timeline-label">DEPENDENCY GRAPH</p>
                  <div className="evx-dash__dep-flow">
                    {osContext.dependencies.nodes.map((node) => (
                      <span
                        key={node.id}
                        className={`evx-dash__dep-node ${node.healthy ? "is-healthy" : "is-unhealthy"}`}
                        title={node.latencyMs ? `${node.latencyMs}ms` : undefined}
                      >
                        {node.name}
                        {node.latencyMs ? ` · ${node.latencyMs}ms` : ""}
                      </span>
                    ))}
                    {osContext.dependencies.edges.map((edge) => (
                      <span key={edge.id} className="evx-dash__dep-arrow">
                        {edge.source} → {edge.destination}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              {osContext.evidence.length > 0 ? (
                <section className="evx-dash__context-section">
                  <p className="evx-dash__timeline-label">EVIDENCE STORE · {osContext.evidence.length} ROWS</p>
                  <div className="evx-dash__table">
                    {osContext.evidence.slice(0, 8).map((item) => (
                      <div key={item.id} className="evx-dash__row" style={{ gridTemplateColumns: "72px 1fr 64px" }}>
                        <span className="evx-dash__chip">{item.type}</span>
                        <span className="evx-dash__event-text">{item.description}</span>
                        <span className="evx-dash__event-at">{formatEventTime(item.occurredAt)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <p className="evx-dash__stat-note">Select a case to view details.</p>
          )}
        </div>
      </section>
    </>
  );
}
