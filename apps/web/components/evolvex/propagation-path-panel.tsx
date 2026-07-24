type CrossServiceHop = {
  service: string;
  role: "origin" | "upstream" | "downstream";
  evidenceCount: number;
  unhealthy: boolean;
  latencyMs: number | null;
  citationRefs: string[];
};

type CrossServicePath = {
  id: string;
  direction: "upstream_cause" | "downstream_effect";
  services: string[];
  score: number;
  confidence: "high" | "medium" | "low";
  summary: string;
  hops: CrossServiceHop[];
};

type PropagationPathPanelProps = {
  summary: string;
  paths: CrossServicePath[];
  onCitationClick?: (timelineEntryId: string) => void;
  citationEntryIdByRef?: Map<string, string>;
};

export function PropagationPathPanel({
  summary,
  paths,
  onCitationClick,
  citationEntryIdByRef,
}: PropagationPathPanelProps) {
  if (paths.length === 0) {
    return (
      <section className="evx-dash__context-card evx-dash__propagation-card">
        <p className="evx-dash__context-card-title">Cross-service propagation</p>
        <p className="evx-dash__stat-note">{summary}</p>
      </section>
    );
  }

  return (
    <section className="evx-dash__context-card evx-dash__propagation-card">
      <p className="evx-dash__context-card-title">Cross-service propagation</p>
      <p className="evx-dash__stat-note" style={{ marginBottom: "0.65rem" }}>
        {summary}
      </p>
      <ol className="evx-dash__propagation-list">
        {paths.map((path) => (
          <li key={path.id} className={`evx-dash__propagation-item dir-${path.direction}`}>
            <div className="evx-dash__propagation-head">
              <span className="evx-dash__propagation-chain">{path.services.join(" → ")}</span>
              <span className="evx-dash__chip">{path.score}%</span>
              <span className="evx-dash__chip">{path.confidence}</span>
              <span className="evx-dash__chip">
                {path.direction === "upstream_cause" ? "upstream cause" : "downstream effect"}
              </span>
            </div>
            <p className="evx-dash__stat-note">{path.summary}</p>
            <ul className="evx-dash__propagation-hops">
              {path.hops.map((hop) => (
                <li key={`${path.id}-${hop.service}`}>
                  <span className="evx-dash__blast-service">{hop.service}</span>
                  <span className="evx-dash__chip">{hop.role}</span>
                  {hop.evidenceCount > 0 ? (
                    <span className="evx-dash__chip">{hop.evidenceCount} signal(s)</span>
                  ) : null}
                  {!hop.healthy ? <span className="evx-dash__chip evx-dash__chip--low">unhealthy</span> : null}
                  {hop.citationRefs.map((ref) => {
                    const entryId = citationEntryIdByRef?.get(ref);
                    if (entryId && onCitationClick) {
                      return (
                        <button
                          key={`${path.id}-${hop.service}-${ref}`}
                          type="button"
                          className="evx-dash__citation-badge evx-dash__citation-badge--btn"
                          onClick={() => onCitationClick(entryId)}
                        >
                          {ref}
                        </button>
                      );
                    }
                    return (
                      <span key={`${path.id}-${hop.service}-${ref}`} className="evx-dash__citation-badge">
                        {ref}
                      </span>
                    );
                  })}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
