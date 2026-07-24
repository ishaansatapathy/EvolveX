import Link from "next/link";

type InvestigationMemoryItem = {
  investigationId: string;
  shortId: string;
  title: string;
  similarityScore: number;
  matchReasons: string[];
  symptoms: string;
  rootCause: string | null;
  fixApplied: string | null;
  fixOutcome: string;
  durationMs: number | null;
  impactSummary: string | null;
  resolvedAt: string;
  primaryService: string | null;
};

type InvestigationMemoryPanelProps = {
  items: InvestigationMemoryItem[];
  activeId?: string;
};

function formatDuration(ms: number | null) {
  if (ms == null || ms <= 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} hr`;
}

export function InvestigationMemoryPanel({ items, activeId }: InvestigationMemoryPanelProps) {
  if (items.length === 0) {
    return (
      <section className="evx-dash__context-card evx-dash__similar-card">
        <p className="evx-dash__context-card-title">Investigation memory</p>
        <p className="evx-dash__stat-note">
          No resolved incidents with comparable symptoms yet. Mark a case resolved to grow org memory.
        </p>
      </section>
    );
  }

  return (
    <section className="evx-dash__context-card evx-dash__similar-card">
      <p className="evx-dash__context-card-title">Investigation memory</p>
      <ul className="evx-dash__similar-list">
        {items.map((item) => (
          <li key={item.investigationId} className={activeId === item.investigationId ? "is-active" : undefined}>
            <Link
              href={`/investigations?investigation=${item.investigationId}`}
              className="evx-dash__similar-link"
            >
              <span className="evx-dash__similar-id">{item.shortId}</span>
              <span className="evx-dash__similar-title">{item.title}</span>
              <span className="evx-dash__chip">{item.similarityScore}% match</span>
            </Link>
            {item.matchReasons.length > 0 ? (
              <p className="evx-dash__stat-note">{item.matchReasons.join(" · ")}</p>
            ) : null}
            {item.rootCause ? (
              <p className="evx-dash__stat-note">
                Root cause: {item.rootCause.slice(0, 180)}
                {item.rootCause.length > 180 ? "…" : ""}
              </p>
            ) : null}
            {item.fixApplied ? (
              <p className="evx-dash__stat-note">
                Fix: {item.fixApplied.slice(0, 160)}
                {item.fixApplied.length > 160 ? "…" : ""}
              </p>
            ) : null}
            <p className="evx-dash__stat-note">
              Resolved {new Date(item.resolvedAt).toLocaleString()}
              {formatDuration(item.durationMs) ? ` · ${formatDuration(item.durationMs)} to resolve` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
