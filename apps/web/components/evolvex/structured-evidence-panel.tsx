type StructuredEvidenceField = {
  label: string;
  value: string;
};

type StructuredEvidenceItem = {
  primary: string;
  secondary?: string;
  occurredAt: string;
  timelineEntryId?: string;
};

type StructuredEvidenceSection = {
  id: "deployment" | "traces" | "logs" | "metrics" | "infrastructure";
  title: string;
  empty: boolean;
  fields: StructuredEvidenceField[];
  items: StructuredEvidenceItem[];
};

type StructuredEvidencePanelProps = {
  sections: StructuredEvidenceSection[];
  onCitationClick?: (timelineEntryId: string) => void;
};

const SECTION_ICONS: Record<StructuredEvidenceSection["id"], string> = {
  deployment: "🚀",
  traces: "🔗",
  logs: "📋",
  metrics: "📊",
  infrastructure: "☸️",
};

function formatItemTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function StructuredEvidencePanel({ sections, onCitationClick }: StructuredEvidencePanelProps) {
  const populated = sections.filter((section) => !section.empty);

  if (populated.length === 0) {
    return (
      <section className="evx-dash__context-card evx-dash__structured-evidence">
        <p className="evx-dash__context-card-title">SUPPORTING EVIDENCE</p>
        <p className="evx-dash__stat-note">No structured evidence yet. Entries appear as SigNoz, GitHub, and K8s data is collected.</p>
      </section>
    );
  }

  return (
    <section className="evx-dash__structured-evidence">
      <p className="evx-dash__timeline-label">SUPPORTING EVIDENCE · STRUCTURED</p>
      <div className="evx-dash__structured-grid">
        {sections.map((section) => (
          <article
            key={section.id}
            className={`evx-dash__context-card evx-dash__structured-section ${section.empty ? "is-empty" : ""}`}
          >
            <p className="evx-dash__context-card-title">
              {SECTION_ICONS[section.id]} {section.title.toUpperCase()}
            </p>

            {section.empty ? (
              <p className="evx-dash__structured-empty">No evidence collected</p>
            ) : (
              <>
                {section.fields.length > 0 ? (
                  <dl className="evx-dash__structured-fields">
                    {section.fields.map((field) => (
                      <div key={`${section.id}-${field.label}`} className="evx-dash__structured-field">
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                {section.items.length > 0 ? (
                  <ul className="evx-dash__structured-items">
                    {section.items.map((item, index) => {
                      const key = item.timelineEntryId ?? `${section.id}-${item.occurredAt}-${index}`;
                      const content = (
                        <>
                          <span className="evx-dash__structured-item-primary">{item.primary}</span>
                          {item.secondary ? (
                            <span className="evx-dash__structured-item-secondary">{item.secondary}</span>
                          ) : null}
                          <span className="evx-dash__structured-item-time">{formatItemTime(item.occurredAt)}</span>
                        </>
                      );

                      if (item.timelineEntryId && onCitationClick) {
                        return (
                          <li key={key}>
                            <button
                              type="button"
                              className="evx-dash__structured-citation"
                              onClick={() => onCitationClick(item.timelineEntryId!)}
                              title="Jump to timeline entry"
                            >
                              {content}
                            </button>
                          </li>
                        );
                      }

                      return (
                        <li key={key} className="evx-dash__structured-item">
                          {content}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
