"use client";

import { useMemo, useState } from "react";

type ServiceMapNode = {
  service: string;
  role: "primary" | "upstream" | "downstream";
  healthy: boolean;
  latencyMs: number | null;
  evidenceCount: number;
  changeCount: number;
};

type ServiceMapEdge = {
  source: string;
  destination: string;
  healthy: boolean;
  latencyMs: number | null;
  evidenceOnPath: number;
};

type BlastImpact = {
  service: string;
  direction: "origin" | "downstream" | "upstream";
  impactScore: number;
  healthy: boolean;
};

type TimelineEntry = {
  id: string;
  occurredAt: string;
  kind: string;
  title: string;
  detail: string;
  source?: string | null;
};

type InteractiveArchitectureViewProps = {
  summary: string;
  primaryService: string;
  graphDepth: number;
  liveSigNozSynced: boolean;
  nodes: ServiceMapNode[];
  edges: ServiceMapEdge[];
  suspectServices: Array<{ service: string; score: number; reasons: string[] }>;
  blastImpacts?: BlastImpact[];
  timeline?: TimelineEntry[];
  onTimelineClick?: (entryId: string) => void;
};

type NodePosition = {
  service: string;
  x: number;
  y: number;
  role: ServiceMapNode["role"];
};

const COL_X: Record<ServiceMapNode["role"], number> = {
  upstream: 72,
  primary: 260,
  downstream: 448,
};

function matchesService(text: string, service: string) {
  return text.toLowerCase().includes(service.toLowerCase());
}

function layoutNodes(nodes: ServiceMapNode[]): NodePosition[] {
  const buckets: Record<ServiceMapNode["role"], ServiceMapNode[]> = {
    upstream: [],
    primary: [],
    downstream: [],
  };

  for (const node of nodes) {
    buckets[node.role].push(node);
  }

  const positions: NodePosition[] = [];
  for (const role of ["upstream", "primary", "downstream"] as const) {
    const column = buckets[role];
    const span = Math.max(column.length, 1);
    column.forEach((node, index) => {
      const y = 48 + index * 92 + ((span - 1) * 92) / 2 - ((column.length - 1) * 92) / 2;
      positions.push({ service: node.service, x: COL_X[role], y, role });
    });
  }

  return positions;
}

export function InteractiveArchitectureView({
  summary,
  primaryService,
  graphDepth,
  liveSigNozSynced,
  nodes,
  edges,
  suspectServices,
  blastImpacts = [],
  timeline = [],
  onTimelineClick,
}: InteractiveArchitectureViewProps) {
  const [selectedService, setSelectedService] = useState<string | null>(primaryService);
  const [showBlastRadius, setShowBlastRadius] = useState(true);

  const nodeByService = useMemo(() => new Map(nodes.map((node) => [node.service, node])), [nodes]);
  const suspectByService = useMemo(
    () => new Map(suspectServices.map((row) => [row.service, row])),
    [suspectServices],
  );
  const blastByService = useMemo(() => new Map(blastImpacts.map((row) => [row.service, row])), [blastImpacts]);
  const positions = useMemo(() => layoutNodes(nodes), [nodes]);
  const positionByService = useMemo(() => new Map(positions.map((row) => [row.service, row])), [positions]);

  const selectedNode = selectedService ? nodeByService.get(selectedService) : undefined;
  const selectedSuspect = selectedService ? suspectByService.get(selectedService) : undefined;
  const selectedBlast = selectedService ? blastByService.get(selectedService) : undefined;

  const selectedTimeline = useMemo(() => {
    if (!selectedService) return [];
    return timeline
      .filter((entry) => matchesService(`${entry.title} ${entry.detail} ${entry.source ?? ""}`, selectedService))
      .slice(0, 8);
  }, [selectedService, timeline]);

  const incoming = selectedService ? edges.filter((edge) => edge.destination === selectedService) : [];
  const outgoing = selectedService ? edges.filter((edge) => edge.source === selectedService) : [];

  const graphHeight = Math.max(220, positions.reduce((max, row) => Math.max(max, row.y), 0) + 80);
  const graphWidth = 520;

  function nodeClass(service: string) {
    const node = nodeByService.get(service);
    const classes = ["evx-arch__node"];
    if (service === primaryService) classes.push("is-primary");
    if (node && !node.healthy) classes.push("is-unhealthy");
    if (suspectByService.has(service)) classes.push("is-suspect");
    if (showBlastRadius && blastByService.has(service)) classes.push("is-blast");
    if (selectedService === service) classes.push("is-selected");
    return classes.join(" ");
  }

  return (
    <section className="evx-dash__context-card evx-dash__arch-card">
      <div className="evx-arch__head">
        <div>
          <p className="evx-dash__context-card-title">Interactive architecture · #56</p>
          <p className="evx-dash__stat-note">
            {summary}
            {liveSigNozSynced ? " · live SigNoz graph" : ""} · depth {graphDepth}
          </p>
        </div>
        <div className="evx-arch__toolbar">
          <label className="evx-arch__toggle">
            <input type="checkbox" checked={showBlastRadius} onChange={(e) => setShowBlastRadius(e.target.checked)} />
            Blast radius
          </label>
        </div>
      </div>

      {nodes.length === 0 ? (
        <p className="evx-dash__stat-note">Service graph populates once SigNoz dependency data is synced.</p>
      ) : (
        <div className="evx-arch__body">
          <div className="evx-arch__canvas-wrap">
            <svg
              className="evx-arch__canvas"
              viewBox={`0 0 ${graphWidth} ${graphHeight}`}
              role="img"
              aria-label="Service dependency architecture"
            >
              <defs>
                <marker id="evx-arch-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="rgba(230,255,0,0.55)" />
                </marker>
              </defs>

              {edges.map((edge) => {
                const from = positionByService.get(edge.source);
                const to = positionByService.get(edge.destination);
                if (!from || !to) return null;
                return (
                  <line
                    key={`${edge.source}-${edge.destination}`}
                    x1={from.x + 56}
                    y1={from.y}
                    x2={to.x - 56}
                    y2={to.y}
                    className={`evx-arch__edge${edge.healthy ? "" : " is-unhealthy"}${
                      showBlastRadius && blastByService.has(edge.source) && blastByService.has(edge.destination)
                        ? " is-blast"
                        : ""
                    }`}
                    markerEnd="url(#evx-arch-arrow)"
                  />
                );
              })}

              {positions.map((pos) => {
                const node = nodeByService.get(pos.service);
                if (!node) return null;
                return (
                  <g
                    key={pos.service}
                    transform={`translate(${pos.x - 56}, ${pos.y - 28})`}
                    className={nodeClass(pos.service)}
                    onClick={() => setSelectedService(pos.service)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedService(pos.service);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <rect width="112" height="56" rx="8" className="evx-arch__node-box" />
                    <text x="56" y="22" textAnchor="middle" className="evx-arch__node-label">
                      {pos.service.length > 14 ? `${pos.service.slice(0, 12)}…` : pos.service}
                    </text>
                    <text x="56" y="40" textAnchor="middle" className="evx-arch__node-meta">
                      {node.latencyMs != null ? `${node.latencyMs}ms` : "—"} · {node.role}
                    </text>
                  </g>
                );
              })}
            </svg>

            <div className="evx-arch__legend">
              <span className="evx-arch__legend-item is-primary">Primary</span>
              <span className="evx-arch__legend-item is-suspect">Suspect</span>
              <span className="evx-arch__legend-item is-blast">Blast radius</span>
              <span className="evx-arch__legend-item is-unhealthy">Unhealthy</span>
            </div>
          </div>

          <aside className="evx-arch__detail">
            {selectedService && selectedNode ? (
              <>
                <p className="evx-arch__detail-title">{selectedService}</p>
                <div className="evx-arch__detail-chips">
                  <span className="evx-dash__chip">{selectedNode.role}</span>
                  <span className={`evx-dash__chip${selectedNode.healthy ? "" : " evx-dash__chip--low"}`}>
                    {selectedNode.healthy ? "healthy" : "unhealthy"}
                  </span>
                  {selectedSuspect ? (
                    <span className="evx-dash__chip">{selectedSuspect.score}% suspect</span>
                  ) : null}
                  {selectedBlast ? (
                    <span className="evx-dash__chip">{selectedBlast.impactScore}% blast impact</span>
                  ) : null}
                </div>

                <dl className="evx-arch__stats">
                  <div>
                    <dt>Latency</dt>
                    <dd>{selectedNode.latencyMs != null ? `${selectedNode.latencyMs}ms` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Evidence</dt>
                    <dd>{selectedNode.evidenceCount}</dd>
                  </div>
                  <div>
                    <dt>Changes</dt>
                    <dd>{selectedNode.changeCount}</dd>
                  </div>
                </dl>

                {selectedSuspect?.reasons.length ? (
                  <p className="evx-dash__stat-note">{selectedSuspect.reasons.join(" · ")}</p>
                ) : null}

                {(incoming.length > 0 || outgoing.length > 0) && (
                  <div className="evx-arch__deps">
                    {incoming.length > 0 ? (
                      <p className="evx-dash__stat-note">
                        <strong>Upstream:</strong> {incoming.map((edge) => edge.source).join(", ")}
                      </p>
                    ) : null}
                    {outgoing.length > 0 ? (
                      <p className="evx-dash__stat-note">
                        <strong>Downstream:</strong> {outgoing.map((edge) => edge.destination).join(", ")}
                      </p>
                    ) : null}
                  </div>
                )}

                <div className="evx-arch__timeline-block">
                  <p className="evx-dash__ti-label">Recent signals</p>
                  {selectedTimeline.length === 0 ? (
                    <p className="evx-dash__stat-note">No timeline events mention this service yet.</p>
                  ) : (
                    <ol className="evx-arch__timeline-list">
                      {selectedTimeline.map((entry) => (
                        <li key={entry.id}>
                          {onTimelineClick ? (
                            <button type="button" className="evx-arch__timeline-link" onClick={() => onTimelineClick(entry.id)}>
                              <span className="evx-dash__chip">{entry.kind}</span>
                              {entry.title}
                            </button>
                          ) : (
                            <>
                              <span className="evx-dash__chip">{entry.kind}</span>
                              {entry.title}
                            </>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </>
            ) : (
              <p className="evx-dash__stat-note">Click a service node to inspect dependencies and incident signals.</p>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
