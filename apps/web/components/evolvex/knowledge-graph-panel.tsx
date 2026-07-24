type KnowledgeGraphNode = {
  id: string;
  kind: "service" | "alert" | "timeline" | "evidence" | "change" | "deploy";
  label: string;
  occurredAt?: string;
  citationRef?: string | null;
};

type KnowledgeGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: "depends_on" | "observed_on" | "deployed_to" | "correlates_with" | "caused_by";
};

type KnowledgeGraphPanelProps = {
  summary: string;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  onCitationClick?: (timelineEntryId: string) => void;
};

const KIND_LABEL: Record<KnowledgeGraphNode["kind"], string> = {
  service: "Service",
  alert: "Alert",
  timeline: "Timeline",
  evidence: "Evidence",
  change: "Change",
  deploy: "Deploy",
};

function timelineIdFromNodeId(nodeId: string) {
  return nodeId.startsWith("timeline:") ? nodeId.slice("timeline:".length) : null;
}

export function KnowledgeGraphPanel({ summary, nodes, edges, onCitationClick }: KnowledgeGraphPanelProps) {
  const grouped = nodes.reduce<Record<string, KnowledgeGraphNode[]>>((acc, node) => {
    acc[node.kind] ??= [];
    acc[node.kind]!.push(node);
    return acc;
  }, {});

  return (
    <section className="evx-dash__context-card evx-dash__graph-card">
      <p className="evx-dash__context-card-title">Investigation knowledge graph</p>
      <p className="evx-dash__stat-note" style={{ marginBottom: "0.65rem" }}>
        {summary}
      </p>

      {nodes.length === 0 ? (
        <p className="evx-dash__stat-note">Graph nodes appear as evidence and dependencies are collected.</p>
      ) : (
        <div className="evx-dash__graph-groups">
          {Object.entries(grouped).map(([kind, items]) => (
            <div key={kind} className="evx-dash__graph-group">
              <p className="evx-dash__graph-group-label">{KIND_LABEL[kind as KnowledgeGraphNode["kind"]] ?? kind}</p>
              <ul className="evx-dash__graph-node-list">
                {items.map((node) => {
                  const timelineEntryId = timelineIdFromNodeId(node.id);
                  const clickable = Boolean(timelineEntryId && onCitationClick);
                  return (
                    <li key={node.id}>
                      {clickable ? (
                        <button
                          type="button"
                          className="evx-dash__graph-node evx-dash__graph-node--btn"
                          onClick={() => onCitationClick!(timelineEntryId!)}
                        >
                          {node.citationRef ? `[${node.citationRef}] ` : ""}
                          {node.label}
                        </button>
                      ) : (
                        <span className="evx-dash__graph-node">
                          {node.citationRef ? `[${node.citationRef}] ` : ""}
                          {node.label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {edges.length > 0 ? (
        <details className="evx-dash__case-inline-details" style={{ marginTop: "0.75rem" }}>
          <summary>{edges.length} relationships</summary>
          <ul className="evx-dash__graph-edge-list">
            {edges.slice(0, 40).map((edge) => (
              <li key={edge.id} className="evx-dash__stat-note">
                {edge.kind.replace("_", " ")} · {edge.source} → {edge.target}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
