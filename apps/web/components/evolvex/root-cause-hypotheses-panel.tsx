type RootCauseHypothesis = {
  id: string;
  title: string;
  confidence: "high" | "medium" | "low";
  rationale: string;
  citationRefs: string[];
  kind: "primary" | "alternative";
};

type RootCauseHypothesesPanelProps = {
  hypotheses: RootCauseHypothesis[];
  onCitationClick?: (timelineEntryId: string) => void;
  citationEntryIdByRef?: Map<string, string>;
};

export function RootCauseHypothesesPanel({
  hypotheses,
  onCitationClick,
  citationEntryIdByRef,
}: RootCauseHypothesesPanelProps) {
  if (hypotheses.length === 0) return null;

  return (
    <section className="evx-dash__context-card evx-dash__hypotheses-card">
      <p className="evx-dash__context-card-title">Root cause hypotheses</p>
      <p className="evx-dash__stat-note" style={{ marginBottom: "0.65rem" }}>
        Ranked from collected evidence — not a single LLM guess.
      </p>
      <ol className="evx-dash__hypotheses-list">
        {hypotheses.map((hypothesis, index) => (
          <li
            key={hypothesis.id}
            className={`evx-dash__hypothesis ${hypothesis.kind === "primary" ? "is-primary" : ""}`}
          >
            <div className="evx-dash__hypothesis-head">
              <span className="evx-dash__hypothesis-rank">{index + 1}</span>
              <p className="evx-dash__hypothesis-title">{hypothesis.title}</p>
              <span className={`evx-dash__chip evx-dash__chip--${hypothesis.confidence}`}>
                {hypothesis.confidence}
              </span>
              {hypothesis.kind === "primary" ? (
                <span className="evx-dash__chip evx-dash__chip--source st-collected">Primary</span>
              ) : null}
            </div>
            <p className="evx-dash__stat-note">{hypothesis.rationale}</p>
            {hypothesis.citationRefs.length > 0 ? (
              <div className="evx-dash__hypothesis-citations">
                {hypothesis.citationRefs.map((ref) => {
                  const entryId = citationEntryIdByRef?.get(ref);
                  if (entryId && onCitationClick) {
                    return (
                      <button
                        key={`${hypothesis.id}-${ref}`}
                        type="button"
                        className="evx-dash__citation-badge evx-dash__citation-badge--btn"
                        onClick={() => onCitationClick(entryId)}
                      >
                        {ref}
                      </button>
                    );
                  }
                  return (
                    <span key={`${hypothesis.id}-${ref}`} className="evx-dash__citation-badge">
                      {ref}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
