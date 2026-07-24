type IncidentNarrativeBeat = {
  occurredAt: string;
  citationRef: string | null;
  timelineEntryId: string;
  kind: string;
  sentence: string;
};

type IncidentNarrativePanelProps = {
  summary: string;
  beats: IncidentNarrativeBeat[];
  empty: boolean;
  onCitationClick?: (timelineEntryId: string) => void;
};

export function IncidentNarrativePanel({
  summary,
  beats,
  empty,
  onCitationClick,
}: IncidentNarrativePanelProps) {
  if (empty) {
    return (
      <section className="evx-dash__context-card evx-dash__narrative-card">
        <p className="evx-dash__context-card-title">INCIDENT NARRATIVE</p>
        <p className="evx-dash__stat-note">{summary}</p>
      </section>
    );
  }

  return (
    <section className="evx-dash__context-card evx-dash__narrative-card">
      <p className="evx-dash__context-card-title">INCIDENT NARRATIVE · CHRONOLOGY</p>
      <p className="evx-dash__narrative-summary">{summary}</p>
      <ol className="evx-dash__narrative-beats">
        {beats.map((beat) => (
          <li key={beat.timelineEntryId} className="evx-dash__narrative-beat">
            <div className="evx-dash__narrative-beat-head">
              <span className={`evx-dash__chip k-${beat.kind.toLowerCase()}`}>{beat.kind}</span>
              {beat.citationRef ? (
                onCitationClick ? (
                  <button
                    type="button"
                    className="evx-dash__citation-link"
                    onClick={() => onCitationClick(beat.timelineEntryId)}
                    title="Jump to timeline entry"
                  >
                    [{beat.citationRef}]
                  </button>
                ) : (
                  <span className="evx-dash__citation-static">[{beat.citationRef}]</span>
                )
              ) : null}
            </div>
            <p className="evx-dash__narrative-sentence">{beat.sentence}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
