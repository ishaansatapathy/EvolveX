type BlastRadiusImpact = {
  service: string;
  direction: "origin" | "downstream" | "upstream";
  impactScore: number;
  healthy: boolean;
  latencyMs: number | null;
  evidenceCount: number;
  reasons: string[];
};

type BlastRadiusPanelProps = {
  summary: string;
  totalAffected: number;
  impacts: BlastRadiusImpact[];
};

export function BlastRadiusPanel({ summary, totalAffected, impacts }: BlastRadiusPanelProps) {
  if (impacts.length === 0) {
    return (
      <section className="evx-dash__context-card evx-dash__blast-card">
        <p className="evx-dash__context-card-title">Blast radius</p>
        <p className="evx-dash__stat-note">{summary}</p>
      </section>
    );
  }

  return (
    <section className="evx-dash__context-card evx-dash__blast-card">
      <p className="evx-dash__context-card-title">Blast radius</p>
      <p className="evx-dash__stat-note" style={{ marginBottom: "0.65rem" }}>
        {summary} · {totalAffected} connected service{totalAffected === 1 ? "" : "s"}
      </p>
      <ol className="evx-dash__blast-list">
        {impacts.map((impact) => (
          <li key={impact.service} className={`evx-dash__blast-item dir-${impact.direction}`}>
            <div className="evx-dash__blast-head">
              <span className="evx-dash__blast-service">{impact.service}</span>
              <span className="evx-dash__chip">{impact.impactScore}% impact</span>
              <span className="evx-dash__chip">{impact.direction}</span>
              {!impact.healthy ? <span className="evx-dash__chip evx-dash__chip--low">unhealthy</span> : null}
            </div>
            {impact.latencyMs != null ? (
              <p className="evx-dash__stat-note">Latency: {impact.latencyMs}ms · Evidence hits: {impact.evidenceCount}</p>
            ) : (
              <p className="evx-dash__stat-note">Evidence hits: {impact.evidenceCount}</p>
            )}
            {impact.reasons.length > 0 ? (
              <p className="evx-dash__stat-note">{impact.reasons.join(" · ")}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
