"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AiConfidenceBadge } from "~/components/evolvex/ai-confidence-badge";
import { AppPageHeader } from "~/components/evolvex/app-shell";
import { CaseStatusControls } from "~/components/evolvex/case-status-controls";
import { EvidenceCitationMarkdown } from "~/components/evolvex/evidence-citation-markdown";
import { IncidentNarrativePanel } from "~/components/evolvex/incident-narrative-panel";
import { InvestigationCaseNav } from "~/components/evolvex/investigation-case-nav";
import { InvestigationSplitPane } from "~/components/evolvex/investigation-split-pane";
import { StructuredEvidencePanel } from "~/components/evolvex/structured-evidence-panel";
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

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function mapUiStatus(
  pipelineStatus: "building" | "ready" | "failed",
  caseStatus: "open" | "investigating" | "monitoring" | "resolved",
) {
  if (pipelineStatus === "building") return "INVESTIGATING";
  if (pipelineStatus === "failed") return "FAILED";
  if (caseStatus === "investigating") return "INVESTIGATING";
  if (caseStatus === "monitoring") return "MONITORING";
  if (caseStatus === "resolved") return "RESOLVED";
  return "OPEN";
}

function formatSeverityLabel(value: string | null | undefined) {
  const normalized = mapSeverity(value);
  return normalized.toUpperCase();
}

function mapSeverity(value: string | null | undefined) {
  const normalized = (value ?? "medium").toLowerCase();
  if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "medium";
}

function isUuid(value: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}


export default function InvestigationsPageContent() {
  const searchParams = useSearchParams();
  const urlInvestigationId = searchParams.get("investigation");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const listQuery = trpc.investigations.list.useQuery(
    { limit: 50 },
    { refetchInterval: (query) => (query.state.data?.some((item) => item.status === "building") ? 3000 : false) },
  );

  const investigations = listQuery.data ?? [];

  useEffect(() => {
    if (isUuid(urlInvestigationId)) {
      setSelectedId(urlInvestigationId);
    }
  }, [urlInvestigationId]);

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

  const suggestFixMutation = trpc.investigations.suggestFix.useMutation();
  const updateCaseStatusMutation = trpc.investigations.updateCaseStatus.useMutation({
    onSuccess: () => {
      void listQuery.refetch();
      void contextQuery.refetch();
    },
  });
  const triggerEbpfMutation = trpc.investigations.triggerEbpfEnrichment.useMutation({
    onSuccess: () => {
      void contextQuery.refetch();
    },
  });
  const postmortemExportQuery = trpc.investigations.exportPostmortem.useQuery(
    { id: activeId ?? "" },
    { enabled: false },
  );
  const [fixPreview, setFixPreview] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [exportingPostmortem, setExportingPostmortem] = useState(false);

  const osContext = contextQuery.data;
  const timeline = osContext?.timeline ?? [];
  const primaryService =
    osContext?.investigation.primaryService ?? activeListItem?.affectedServices[0] ?? "unknown";

  const pinpointQuery = trpc.investigations.pinpoint.useQuery(
    { id: activeId ?? "" },
    { enabled: Boolean(activeId) && osContext?.investigation.status === "ready" },
  );

  const timelineCitationRefById = useMemo(() => {
    const map = new Map<string, string>();
    for (const citation of osContext?.evidenceCitations.citations ?? []) {
      if (citation.ref.startsWith("T") && citation.timelineEntryId) {
        map.set(citation.timelineEntryId, citation.ref);
      }
    }
    return map;
  }, [osContext?.evidenceCitations.citations]);

  const evidenceCitationRefById = useMemo(() => {
    const map = new Map<string, string>();
    for (const citation of osContext?.evidenceCitations.citations ?? []) {
      if (citation.ref.startsWith("E") && citation.evidenceId) {
        map.set(citation.evidenceId, citation.ref);
      }
    }
    return map;
  }, [osContext?.evidenceCitations.citations]);

  const summaryText =
    osContext?.investigation.summary ??
    (osContext?.investigation.status === "building"
      ? "Collecting evidence from SigNoz…"
      : "No context generated yet.");

  function scrollWithinDetail(element: HTMLElement | null, offset = 88) {
    const container = detailScrollRef.current;
    if (!container || !element) return;

    const containerTop = container.getBoundingClientRect().top;
    const elementTop = element.getBoundingClientRect().top;
    container.scrollBy({ top: elementTop - containerTop - offset, behavior: "smooth" });
  }

  function scrollToSection(sectionId: string) {
    if (sectionId === "case-timeline") {
      scrollToTimeline();
      return;
    }
    scrollWithinDetail(document.getElementById(sectionId));
  }

  function scrollToTimeline() {
    scrollWithinDetail(timelineRef.current);
  }

  function scrollToTimelineEntry(entryId: string) {
    const entry = detailScrollRef.current?.querySelector(`[data-timeline-entry-id="${entryId}"]`);
    if (entry instanceof HTMLElement) {
      scrollWithinDetail(entry, 48);
      entry.classList.add("is-citation-highlight");
      window.setTimeout(() => entry.classList.remove("is-citation-highlight"), 2200);
      return;
    }
    scrollToTimeline();
  }

  async function fetchPostmortemExport() {
    if (!activeId) return null;
    const result = await postmortemExportQuery.refetch();
    return result.data ?? null;
  }

  async function handleDownloadPostmortem() {
    setExportingPostmortem(true);
    try {
      const exported = await fetchPostmortemExport();
      if (!exported) {
        alert("Could not export postmortem for this case.");
        return;
      }
      downloadTextFile(exported.filename, exported.markdown);
    } finally {
      setExportingPostmortem(false);
    }
  }

  async function handleCopyPostmortem() {
    setExportingPostmortem(true);
    try {
      const exported = await fetchPostmortemExport();
      if (!exported) {
        alert("Could not export postmortem for this case.");
        return;
      }
      await navigator.clipboard.writeText(exported.markdown);
    } finally {
      setExportingPostmortem(false);
    }
  }

  if (listQuery.isLoading) {
    return (
      <>
        <AppPageHeader kicker="⊙ ACTIVE CASE FILES" title="Investigations" />
        <p className="evx-dash__stat-note">Loading investigations…</p>
      </>
    );
  }

  if (listQuery.isError) {
    const needsSignIn =
      listQuery.error.data?.code === "UNAUTHORIZED" ||
      listQuery.error.message.toLowerCase().includes("not authenticated");

    return (
      <>
        <AppPageHeader kicker="⊙ ACTIVE CASE FILES" title="Investigations" />
        <section className="evx-dash__settings-card" style={{ marginTop: "1rem" }}>
          <p className="evx-dash__settings-label">{needsSignIn ? "SESSION EXPIRED" : "COULD NOT LOAD CASES"}</p>
          <p className="evx-dash__settings-value">
            {needsSignIn
              ? "Sign in again to load your investigation queue."
              : listQuery.error.message}
          </p>
          <div className="evx-dash__cause-actions" style={{ marginTop: "1rem" }}>
            {needsSignIn ? (
              <Link href="/signin" className="evx-dash__btn-primary">
                Sign in →
              </Link>
            ) : (
              <button type="button" className="evx-dash__btn-primary" onClick={() => void listQuery.refetch()}>
                Retry →
              </button>
            )}
          </div>
        </section>
      </>
    );
  }

  if (investigations.length === 0) {
    return (
      <>
        <AppPageHeader kicker="⊙ ACTIVE CASE FILES" title="Investigations" />
        <section className="evx-dash__settings-card" style={{ marginTop: "1rem" }}>
          <p className="evx-dash__settings-label">NO CASES YET</p>
          <p className="evx-dash__settings-value">Connect SigNoz Cloud — or seed a demo case locally</p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.75rem" }}>
            <strong>Fastest demo:</strong> in a new terminal run <code>pnpm investigation:seed</code>, then refresh this page.
            <br />
            <br />
            <strong>Live alerts path:</strong>
            <br />
            1. Set <code>SIGNOZ_WEBHOOK_SECRET</code> + expose <code>POST /webhooks/signoz</code> (see <code>docs/WIRING.md</code>)
            <br />
            2. Add webhook URL in SigNoz Notification Channels
            <br />
            3. Fire alert via <code>pnpm signoz:p99</code> or SigNoz UI
            <br />
            4. Ensure <code>INVESTIGATION_OWNER_EMAIL</code> matches your login email
          </p>
          <div className="evx-dash__cause-actions" style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="evx-dash__btn-primary"
              onClick={() => void listQuery.refetch()}
            >
              Refresh cases →
            </button>
            <Link href="/settings" className="evx-dash__btn-ghost">
              Integration health →
            </Link>
          </div>
        </section>
      </>
    );
  }

  return (
    <div className="evx-dash__investigations-layout">
      <AppPageHeader
        kicker="⊙ ACTIVE CASE FILES"
        title="Investigations"
        subtitle={`${investigations.length} case${investigations.length === 1 ? "" : "s"} ┬╖ SigNoz alerts`}
      />

      <InvestigationSplitPane
        left={
          <div className="evx-dash__incidents evx-dash__incidents--fixed">
            <div className="evx-dash__incidents-panel">
              <div className="evx-dash__incidents-panel-head">
                <p className="evx-dash__panel-label">INCIDENT QUEUE</p>
                <span className="evx-dash__incidents-count">{investigations.length} active</span>
              </div>
              {investigations.map((inc) => {
                const isActive = activeId === inc.id;
                const evidencePercent =
                  isActive && contextQuery.data?.evidenceCompleteness
                    ? contextQuery.data.evidenceCompleteness.completenessPercent
                    : null;

                return (
                  <button
                    key={inc.id}
                    type="button"
                    className={`evx-dash__incident sev-${mapSeverity(inc.severity)} ${isActive ? "is-selected" : ""}`}
                    onClick={() => setSelectedId(inc.id)}
                  >
                    <span className="evx-dash__incident-top">
                      <span className="evx-dash__incident-id">{inc.shortId}</span>
                      <span className="evx-dash__incident-badges">
                        {isActive ? <span className="evx-dash__incident-viewing">VIEWING</span> : null}
                        <span className={`evx-dash__incident-severity sev-${mapSeverity(inc.severity)}`}>
                          {formatSeverityLabel(inc.severity)}
                        </span>
                        <span className={`evx-dash__incident-status st-${mapUiStatus(inc.status, inc.caseStatus).toLowerCase()}`}>
                          {mapUiStatus(inc.status, inc.caseStatus)}
                        </span>
                      </span>
                    </span>
                    <span className="evx-dash__incident-title">{inc.title}</span>
                    <span className="evx-dash__incident-footer">
                      <span className="evx-dash__incident-service">{inc.affectedServices[0] ?? "unknown"}</span>
                      <span className="evx-dash__incident-meta">{formatRelativeTime(inc.createdAt)}</span>
                      {evidencePercent !== null ? (
                        <span className="evx-dash__incident-evidence">{evidencePercent}% evidence</span>
                      ) : inc.status === "building" ? (
                        <span className="evx-dash__incident-evidence is-building">collecting…</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        }
        right={
          <div ref={detailScrollRef} className="evx-dash__detail evx-dash__detail--case evx-dash__detail--scroll">
          {contextQuery.isLoading && !osContext ? (
            <p className="evx-dash__stat-note">Loading case context from Postgres…</p>
          ) : osContext && activeListItem ? (
            <div className="evx-dash__case-shell">
              <header className="evx-dash__case-hero">
                <div className="evx-dash__case-hero-top">
                  <div className="evx-dash__case-hero-main">
                    <p className="evx-dash__case-hero-kicker">
                      {activeListItem.shortId} ┬╖ {primaryService}
                      {osContext.investigation.incidentId ? ` ┬╖ ${osContext.investigation.incidentId}` : ""}
                    </p>
                    <h2 className="evx-dash__case-hero-title">{activeListItem.title}</h2>
                  </div>
                  <div className="evx-dash__case-hero-badges">
                    <span className={`evx-dash__chip evx-dash__case-status st-${mapUiStatus(activeListItem.status, osContext.investigation.caseStatus).toLowerCase()}`}>
                      {mapUiStatus(activeListItem.status, osContext.investigation.caseStatus)}
                    </span>
                    {osContext.evidenceCompleteness ? (
                      <span
                        className="evx-dash__chip evx-dash__case-completeness"
                        title={osContext.evidenceCompleteness.summary}
                      >
                        {osContext.evidenceCompleteness.completenessPercent}% evidence
                      </span>
                    ) : null}
                  </div>
                </div>

                <InvestigationCaseNav onJump={scrollToSection} />

                <CaseStatusControls
                  value={osContext.investigation.caseStatus}
                  disabled={updateCaseStatusMutation.isPending || activeListItem.status === "building"}
                  onChange={(caseStatus) => {
                    if (!activeId) return;
                    updateCaseStatusMutation.mutate({ id: activeId, caseStatus });
                  }}
                />

                <div className="evx-dash__case-hero-actions">
                  <button type="button" className="evx-dash__btn-primary" onClick={scrollToTimeline}>
                    Open timeline
                  </button>
                  <Link href={`/logs?investigation=${activeListItem.id}&service=${primaryService}`} className="evx-dash__btn-ghost">
                    Logs
                  </Link>
                  <Link href={`/traces?investigation=${activeListItem.id}&service=${primaryService}`} className="evx-dash__btn-ghost">
                    Traces
                  </Link>
                  {timeline.length > 0 ? (
                    <details className="evx-dash__case-more-menu">
                      <summary className="evx-dash__btn-ghost">Export</summary>
                      <div className="evx-dash__case-more-menu-panel">
                        <button
                          type="button"
                          className="evx-dash__btn-ghost"
                          disabled={exportingPostmortem}
                          onClick={() => void handleDownloadPostmortem()}
                        >
                          {exportingPostmortem ? "Exporting…" : "Download postmortem"}
                        </button>
                        <button
                          type="button"
                          className="evx-dash__btn-ghost"
                          disabled={exportingPostmortem}
                          onClick={() => void handleCopyPostmortem()}
                        >
                          Copy markdown
                        </button>
                      </div>
                    </details>
                  ) : null}
                </div>
              </header>

              <section id="case-story" className="evx-dash__case-section">
                <p className="evx-dash__case-section-label">Story</p>
                <div className="evx-dash__case-story-stack">
                  {osContext.incidentNarrative ? (
                    <IncidentNarrativePanel
                      variant="summary"
                      summary={osContext.incidentNarrative.summary || summaryText}
                      beats={osContext.incidentNarrative.beats}
                      empty={osContext.incidentNarrative.empty}
                      onCitationClick={scrollToTimelineEntry}
                    />
                  ) : (
                    <section className="evx-dash__cause evx-dash__cause--story">
                      <p className="evx-dash__cause-kicker">✦ INCIDENT STORY</p>
                      <p className="evx-dash__cause-text">{summaryText}</p>
                    </section>
                  )}

                  {osContext.llmSummary ? (
                    <section className="evx-dash__cause evx-dash__cause--ai">
                      <div className="evx-dash__cause-ai-head">
                        <p className="evx-dash__cause-kicker">✦ AI ROOT CAUSE</p>
                        <AiConfidenceBadge
                          level={osContext.aiConfidence.level}
                          rationale={osContext.aiConfidence.rationale}
                        />
                      </div>
                      <div className="evx-dash__cause-text">
                        <EvidenceCitationMarkdown
                          markdown={osContext.llmSummary.markdown}
                          citations={osContext.evidenceCitations.citations}
                          onCitationClick={scrollToTimelineEntry}
                        />
                      </div>
                      <div className="evx-dash__cause-footer">
                        <p className="evx-dash__cause-meta">
                          Generated {formatRelativeTime(osContext.llmSummary.generatedAt)} ┬╖ click [T1]/[E1] to jump
                        </p>
                        {osContext.investigation.status === "ready" ? (
                          <button
                            type="button"
                            className="evx-dash__btn-ghost"
                            disabled={regenerateSummaryMutation.isPending}
                            onClick={() => activeId && regenerateSummaryMutation.mutate({ id: activeId })}
                          >
                            {regenerateSummaryMutation.isPending ? "Regenerating…" : "Regenerate"}
                          </button>
                        ) : null}
                      </div>
                    </section>
                  ) : osContext.investigation.status === "ready" ? (
                    <section className="evx-dash__cause evx-dash__cause--ai">
                      <p className="evx-dash__cause-kicker">✦ AI ROOT CAUSE</p>
                      <p className="evx-dash__cause-text">
                        No LLM summary yet. Configure OPENAI_API_KEY and generate from collected evidence.
                      </p>
                      <div className="evx-dash__cause-actions">
                        <button
                          type="button"
                          className="evx-dash__btn-primary"
                          disabled={regenerateSummaryMutation.isPending}
                          onClick={() => activeId && regenerateSummaryMutation.mutate({ id: activeId })}
                        >
                          {regenerateSummaryMutation.isPending ? "Generating…" : "Generate summary"}
                        </button>
                      </div>
                    </section>
                  ) : null}
                </div>
              </section>

              <section id="case-evidence" className="evx-dash__case-section">
                <p className="evx-dash__case-section-label">Evidence</p>
                {osContext.ebpfEnrichment.recommended && !osContext.ebpfEnrichment.collected ? (
                  <section className="evx-dash__context-card evx-dash__ebpf-card">
                    <p className="evx-dash__context-card-title">KERNEL SIGNALS ┬╖ EBPF</p>
                    <p className="evx-dash__stat-note">
                      Tail latency case — kernel/network metrics can explain p99 degradation beyond trace averages.
                    </p>
                    <button
                      type="button"
                      className="evx-dash__btn-primary"
                      style={{ marginTop: "0.6rem" }}
                      disabled={!osContext.ebpfEnrichment.canTrigger || triggerEbpfMutation.isPending}
                      onClick={() => activeId && triggerEbpfMutation.mutate({ id: activeId })}
                    >
                      {triggerEbpfMutation.isPending
                        ? "Collecting…"
                        : osContext.ebpfEnrichment.canTrigger
                          ? "Collect eBPF signals from SigNoz"
                          : "SigNoz not configured"}
                    </button>
                    {triggerEbpfMutation.data?.message ? (
                      <p className="evx-dash__stat-note" style={{ marginTop: "0.45rem" }}>
                        {triggerEbpfMutation.data.message}
                      </p>
                    ) : null}
                  </section>
                ) : null}
                {osContext.incidentNarrative && !osContext.incidentNarrative.empty ? (
                  <IncidentNarrativePanel
                    variant="chronology"
                    summary={osContext.incidentNarrative.summary}
                    beats={osContext.incidentNarrative.beats}
                    empty={osContext.incidentNarrative.empty}
                    onCitationClick={scrollToTimelineEntry}
                  />
                ) : null}
                <div className="evx-dash__case-split">
                  {osContext.evidenceCompleteness ? (
                    <section className="evx-dash__context-card evx-dash__completeness-card evx-dash__completeness-card--compact">
                      <p className="evx-dash__context-card-title">Completeness</p>
                      <div className="evx-dash__completeness-head">
                        <p className="evx-dash__completeness-percent">
                          {osContext.evidenceCompleteness.completenessPercent}%
                        </p>
                        <p className="evx-dash__stat-note">{osContext.evidenceCompleteness.summary}</p>
                      </div>
                      <div
                        className="evx-dash__completeness-bar"
                        role="progressbar"
                        aria-valuenow={osContext.evidenceCompleteness.completenessPercent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <span
                          className="evx-dash__completeness-bar-fill"
                          style={{ width: `${osContext.evidenceCompleteness.completenessPercent}%` }}
                        />
                      </div>
                      <div className="evx-dash__completeness-sources">
                        {osContext.evidenceCompleteness.sources.map((source) => (
                          <span
                            key={source.id}
                            className={`evx-dash__chip evx-dash__chip--source st-${source.status}`}
                            title={source.detail}
                          >
                            {source.label}
                            {source.status === "collected"
                              ? " ✓"
                              : source.status === "missing"
                                ? " ┬╖ missing"
                                : source.status === "partial"
                                  ? " ┬╖ optional"
                                  : " ┬╖ n/a"}
                          </span>
                        ))}
                      </div>
                      {!osContext.evidenceCompleteness.canConclude &&
                      (osContext.evidenceCompleteness.missingForConclusion.length > 0 ||
                        osContext.evidenceCompleteness.recommendedNextSteps.length > 0) ? (
                        <details className="evx-dash__case-inline-details">
                          <summary>What&apos;s missing</summary>
                          {osContext.evidenceCompleteness.missingForConclusion.length > 0 ? (
                            <div className="evx-dash__completeness-block">
                              <p className="evx-dash__completeness-label">Additional evidence required</p>
                              <ul className="evx-dash__completeness-list">
                                {osContext.evidenceCompleteness.missingForConclusion.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {osContext.evidenceCompleteness.recommendedNextSteps.length > 0 ? (
                            <div className="evx-dash__completeness-block">
                              <p className="evx-dash__completeness-label">Recommended next steps</p>
                              <ul className="evx-dash__completeness-list">
                                {osContext.evidenceCompleteness.recommendedNextSteps.map((step) => (
                                  <li key={step}>{step}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </details>
                      ) : null}
                    </section>
                  ) : null}

                  {osContext.structuredEvidence ? (
                    <StructuredEvidencePanel
                      sections={osContext.structuredEvidence.sections}
                      onCitationClick={scrollToTimelineEntry}
                    />
                  ) : null}
                </div>
              </section>

              <section id="case-analysis" className="evx-dash__case-section">
                <p className="evx-dash__case-section-label">Analysis</p>
                {pinpointQuery.data?.primary ? (
                  <section className="evx-dash__context-card evx-dash__pinpoint-card">
                    <p className="evx-dash__context-card-title">Likely culprit ┬╖ Pinpoint</p>
                    <p className="evx-dash__pinpoint-file">
                      {pinpointQuery.data.primary.file}
                      {pinpointQuery.data.primary.line > 0 ? `:${pinpointQuery.data.primary.line}` : ""}
                    </p>
                    <p className="evx-dash__stat-note">{pinpointQuery.data.primary.evidence}</p>
                    <div className="evx-dash__toolbar" style={{ marginTop: "0.65rem" }}>
                      <span className={`evx-dash__chip evx-dash__chip--${pinpointQuery.data.primary.confidence}`}>
                        {pinpointQuery.data.primary.confidence} confidence
                      </span>
                      <span className="evx-dash__chip">{pinpointQuery.data.primary.source.replace("_", " ")}</span>
                      {pinpointQuery.data.primary.githubUrl ? (
                        <a
                          href={pinpointQuery.data.primary.githubUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="evx-dash__btn-ghost"
                        >
                          GitHub →
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className="evx-dash__btn-primary"
                        disabled={suggestFixMutation.isPending}
                        onClick={async () => {
                          if (!activeId) return;
                          const result = await suggestFixMutation.mutateAsync({ id: activeId });
                          if (result) setFixPreview(result.patch);
                        }}
                      >
                        {suggestFixMutation.isPending ? "Analyzing…" : "Suggest fix"}
                      </button>
                    </div>
                    {pinpointQuery.data.deployCorrelation ? (
                      <p className="evx-dash__stat-note" style={{ marginTop: "0.45rem" }}>
                        Deploy:{" "}
                        <a href={pinpointQuery.data.deployCorrelation.url} target="_blank" rel="noreferrer">
                          {pinpointQuery.data.deployCorrelation.repo}@{pinpointQuery.data.deployCorrelation.sha.slice(0, 7)}
                        </a>
                        {pinpointQuery.data.deployCorrelation.changedFiles.length
                          ? ` ┬╖ ${pinpointQuery.data.deployCorrelation.changedFiles.slice(0, 4).join(", ")}`
                          : null}
                      </p>
                    ) : null}
                    {fixPreview ? (
                      <>
                        <pre className="evx-dash__fix-preview">{fixPreview}</pre>
                        <button
                          type="button"
                          className="evx-dash__btn-ghost"
                          style={{ marginTop: "0.5rem" }}
                          onClick={() => void navigator.clipboard.writeText(fixPreview)}
                        >
                          Copy patch
                        </button>
                      </>
                    ) : null}
                  </section>
                ) : pinpointQuery.isLoading ? (
                  <p className="evx-dash__stat-note">Scanning logs for file:line pinpoint…</p>
                ) : (
                  <p className="evx-dash__stat-note">Pinpoint analysis will appear when the case is ready.</p>
                )}
              </section>

              <section id="case-timeline" className="evx-dash__case-section" ref={timelineRef}>
                <p className="evx-dash__case-section-label">Timeline</p>
                {timeline.length === 0 ? (
                  <p className="evx-dash__stat-note">Timeline entries will appear as evidence is collected.</p>
                ) : (
                  <section className="evx-dash__context-card evx-dash__narrative-card evx-dash__timeline-card">
                    <p className="evx-dash__context-card-title">EVIDENCE TIMELINE ┬╖ POSTGRES</p>
                    <ol className="evx-dash__narrative-beats">
                      {timeline.map((ev) => (
                        <li key={ev.id} className="evx-dash__narrative-beat" data-timeline-entry-id={ev.id}>
                          <div className="evx-dash__narrative-beat-head">
                            <span className="evx-dash__event-at">{formatEventTime(ev.occurredAt)}</span>
                            {timelineCitationRefById.get(ev.id) ? (
                              <span className="evx-dash__citation-badge">{timelineCitationRefById.get(ev.id)}</span>
                            ) : null}
                            <span className={`evx-dash__chip k-${ev.kind.toLowerCase()}`}>{ev.kind}</span>
                          </div>
                          <p className="evx-dash__narrative-sentence">
                            <strong>{ev.title}</strong> — {ev.detail}
                            {ev.source ? <span className="evx-dash__event-source"> ┬╖ {ev.source}</span> : null}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </section>

              <details className="evx-dash__case-more">
                <summary>Notes, dependencies &amp; raw evidence</summary>
                <div className="evx-dash__case-more-body">
                  <section className="evx-dash__context-card">
                    <p className="evx-dash__context-card-title">Engineer notes</p>
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

                  {osContext.dependencies.nodes.length > 0 ? (
                    <section className="evx-dash__context-section">
                      <p className="evx-dash__timeline-label">Dependency graph</p>
                      <div className="evx-dash__dep-flow">
                        {osContext.dependencies.nodes.map((node) => (
                          <span
                            key={node.id}
                            className={`evx-dash__dep-node ${node.healthy ? "is-healthy" : "is-unhealthy"}`}
                            title={node.latencyMs ? `${node.latencyMs}ms` : undefined}
                          >
                            {node.name}
                            {node.latencyMs ? ` ┬╖ ${node.latencyMs}ms` : ""}
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
                      <p className="evx-dash__timeline-label">Evidence store ┬╖ {osContext.evidence.length} rows</p>
                      <div className="evx-dash__table">
                        {osContext.evidence.slice(0, 8).map((item) => {
                          const ref = evidenceCitationRefById.get(item.id);
                          const rowContent = (
                            <>
                              <span className="evx-dash__chip">
                                {item.type}
                                {ref ? ` ┬╖ ${ref}` : ""}
                              </span>
                              <span className="evx-dash__event-text">{item.description}</span>
                              <span className="evx-dash__event-at">{formatEventTime(item.occurredAt)}</span>
                            </>
                          );

                          if (item.timelineEntryId) {
                            return (
                              <button
                                key={item.id}
                                type="button"
                                className="evx-dash__row evx-dash__row--citation"
                                style={{ gridTemplateColumns: "72px 1fr 64px" }}
                                onClick={() => scrollToTimelineEntry(item.timelineEntryId!)}
                                title={`Jump to timeline ${ref ?? ""}`.trim()}
                              >
                                {rowContent}
                              </button>
                            );
                          }

                          return (
                            <div key={item.id} className="evx-dash__row" style={{ gridTemplateColumns: "72px 1fr 64px" }}>
                              {rowContent}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}
                </div>
              </details>
            </div>
          ) : (
            <p className="evx-dash__stat-note">Select a case to view details.</p>
          )}
          </div>
        }
      />
    </div>
  );
}
