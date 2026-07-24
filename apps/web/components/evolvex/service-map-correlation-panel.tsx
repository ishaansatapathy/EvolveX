type ServiceMapNodeInsight = {
  service: string;
  role: "primary" | "upstream" | "downstream";
  healthy: boolean;
  latencyMs: number | null;
  evidenceCount: number;
  changeCount: number;
};

type ServiceMapPropagationPath = {
  id: string;
  direction: "upstream_cause" | "downstream_effect";
  services: string[];
  score: number;
  confidence: "high" | "medium" | "low";
  summary: string;
};

type ServiceMapCorrelationPanelProps = {
  summary: string;
  primaryService: string;
  graphDepth: number;
  liveSigNozSynced: boolean;
  nodes: ServiceMapNodeInsight[];
  propagationPaths: ServiceMapPropagationPath[];
  suspectServices: Array<{ service: string; score: number; reasons: string[] }>;
};

export function ServiceMapCorrelationPanel({
  summary,
  primaryService,
  graphDepth,
  liveSigNozSynced,
  nodes,
  propagationPaths,
  suspectServices,
}: ServiceMapCorrelationPanelProps) {
  return (
    <section className="evx-dash__context-card evx-dash__service-map-card">
      <p className="evx-dash__context-card-title">Service map correlation</p>
      <p className="evx-dash__stat-note" style={{ marginBottom: "0.65rem" }}>
        {summary}
        {liveSigNozSynced ? " · live SigNoz graph" : ""}
      </p>
      <p className="evx-dash__stat-note">
        Primary: {primaryService} · depth {graphDepth} · {nodes.length} node{nodes.length === 1 ? "" : "s"}
      </p>

      {suspectServices.length > 0 ? (
        <ol className="evx-dash__blast-list" style={{ marginTop: "0.65rem" }}>
          {suspectServices.map((item) => (
            <li key={item.service} className="evx-dash__blast-item">
              <div className="evx-dash__blast-head">
                <span className="evx-dash__blast-service">{item.service}</span>
                <span className="evx-dash__chip">{item.score}% suspect</span>
              </div>
              {item.reasons.length > 0 ? (
                <p className="evx-dash__stat-note">{item.reasons.join(" · ")}</p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {propagationPaths.length > 0 ? (
        <ol className="evx-dash__propagation-list" style={{ marginTop: "0.65rem" }}>
          {propagationPaths.slice(0, 3).map((path) => (
            <li key={path.id} className={`evx-dash__propagation-item dir-${path.direction}`}>
              <div className="evx-dash__propagation-head">
                <span className="evx-dash__propagation-chain">{path.services.join(" → ")}</span>
                <span className="evx-dash__chip">{path.score}%</span>
                <span className="evx-dash__chip">{path.confidence}</span>
              </div>
              <p className="evx-dash__stat-note">{path.summary}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
