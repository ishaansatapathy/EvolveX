"use client";

type PipelineCacheState = "valid" | "miss" | "expired" | "stale" | "none";

type PipelineCachePanelProps = {
  state: PipelineCacheState;
  hit: boolean;
  cachedAt: string | null;
  expiresAt: string | null;
  ttlMs: number;
  missReasonLabel: string;
  skipsExpensiveRecompute: boolean;
  pipelineStatus: "building" | "ready" | "failed";
  refreshing: boolean;
  refreshMessage: string | null;
  onRefresh: () => void;
};

function formatDuration(ms: number) {
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours >= 24) return `${Math.round(hours / 24)}d`;
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stateLabel(state: PipelineCacheState, hit: boolean) {
  if (hit) return "Cache hit";
  if (state === "stale") return "Stale";
  if (state === "expired") return "Expired";
  if (state === "none") return "Uncached";
  return "Cache miss";
}

export function PipelineCachePanel({
  state,
  hit,
  cachedAt,
  expiresAt,
  ttlMs,
  missReasonLabel,
  skipsExpensiveRecompute,
  pipelineStatus,
  refreshing,
  refreshMessage,
  onRefresh,
}: PipelineCachePanelProps) {
  const canRefresh = pipelineStatus !== "building";

  return (
    <section className="evx-dash__context-card evx-dash__pipeline-cache-card">
      <div className="evx-dash__pipeline-cache-head">
        <p className="evx-dash__context-card-title">PIPELINE CACHE</p>
        <span className={`evx-dash__pipeline-cache-badge is-${state}${hit ? " is-hit" : ""}`}>
          {stateLabel(state, hit)}
        </span>
      </div>
      <p className="evx-dash__stat-note">
        {hit
          ? "Evidence pipeline results are cached — expensive SigNoz queries are skipped until TTL expires or content changes."
          : missReasonLabel}
      </p>
      <dl className="evx-dash__pipeline-cache-meta">
        <div>
          <dt>TTL</dt>
          <dd>{formatDuration(ttlMs)}</dd>
        </div>
        {cachedAt ? (
          <div>
            <dt>Cached</dt>
            <dd>{formatTimestamp(cachedAt)}</dd>
          </div>
        ) : null}
        {expiresAt ? (
          <div>
            <dt>{hit ? "Expires" : "Last expired"}</dt>
            <dd>{formatTimestamp(expiresAt)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Recompute</dt>
          <dd>{skipsExpensiveRecompute ? "Skipped" : "Required"}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="evx-dash__btn-ghost evx-dash__pipeline-cache-refresh"
        disabled={!canRefresh || refreshing}
        onClick={onRefresh}
      >
        {refreshing ? "Refreshing…" : pipelineStatus === "building" ? "Pipeline running…" : "Refresh pipeline"}
      </button>
      {refreshMessage ? (
        <p className="evx-dash__stat-note evx-dash__pipeline-cache-message">{refreshMessage}</p>
      ) : null}
    </section>
  );
}
