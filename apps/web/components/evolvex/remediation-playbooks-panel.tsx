type RemediationPlaybookStep = {
  id: string;
  title: string;
  priority: "immediate" | "investigate" | "mitigate";
  rationale: string;
  commands: string[];
  citationRefs: string[];
};

type RemediationPlaybooksPanelProps = {
  summary: string;
  steps: RemediationPlaybookStep[];
  onCitationClick?: (timelineEntryId: string) => void;
  citationEntryIdByRef?: Map<string, string>;
};

const PRIORITY_LABELS: Record<RemediationPlaybookStep["priority"], string> = {
  immediate: "Immediate",
  investigate: "Investigate",
  mitigate: "Mitigate",
};

export function RemediationPlaybooksPanel({
  summary,
  steps,
  onCitationClick,
  citationEntryIdByRef,
}: RemediationPlaybooksPanelProps) {
  if (steps.length === 0) {
    return (
      <section className="evx-dash__context-card evx-dash__playbook-card">
        <p className="evx-dash__context-card-title">Remediation playbook</p>
        <p className="evx-dash__stat-note">{summary}</p>
      </section>
    );
  }

  return (
    <section className="evx-dash__context-card evx-dash__playbook-card">
      <p className="evx-dash__context-card-title">Remediation playbook</p>
      <p className="evx-dash__stat-note" style={{ marginBottom: "0.65rem" }}>
        {summary}
      </p>
      <ol className="evx-dash__playbook-list">
        {steps.map((step, index) => (
          <li key={step.id} className={`evx-dash__playbook-item priority-${step.priority}`}>
            <div className="evx-dash__playbook-head">
              <span className="evx-dash__playbook-rank">{index + 1}</span>
              <p className="evx-dash__playbook-title">{step.title}</p>
              <span className="evx-dash__chip">{PRIORITY_LABELS[step.priority]}</span>
            </div>
            <p className="evx-dash__stat-note">{step.rationale}</p>
            {step.commands.length > 0 ? (
              <pre className="evx-dash__playbook-commands">{step.commands.join("\n")}</pre>
            ) : null}
            {step.citationRefs.length > 0 ? (
              <div className="evx-dash__hypothesis-citations">
                {step.citationRefs.map((ref) => {
                  const entryId = citationEntryIdByRef?.get(ref);
                  if (entryId && onCitationClick) {
                    return (
                      <button
                        key={`${step.id}-${ref}`}
                        type="button"
                        className="evx-dash__citation-badge evx-dash__citation-badge--btn"
                        onClick={() => onCitationClick(entryId)}
                      >
                        {ref}
                      </button>
                    );
                  }
                  return (
                    <span key={`${step.id}-${ref}`} className="evx-dash__citation-badge">
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
