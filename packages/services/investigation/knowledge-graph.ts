import type {
  ChangeEventRowDto,
  DependencyEdgeDto,
  EvidenceRowDto,
  TimelineEntryDto,
} from "./types";

export type KnowledgeGraphNodeKind =
  | "service"
  | "alert"
  | "timeline"
  | "evidence"
  | "change"
  | "deploy";

export type KnowledgeGraphEdgeKind =
  | "depends_on"
  | "observed_on"
  | "deployed_to"
  | "correlates_with"
  | "caused_by";

export type KnowledgeGraphNode = {
  id: string;
  kind: KnowledgeGraphNodeKind;
  label: string;
  occurredAt?: string;
  citationRef?: string | null;
};

export type KnowledgeGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: KnowledgeGraphEdgeKind;
};

export type KnowledgeGraphResult = {
  summary: string;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
};

/** Builds an evidence-linked investigation graph from real Postgres artifacts only. */
export function buildInvestigationKnowledgeGraph(input: {
  primaryService: string | null;
  alertName?: string | null;
  timeline: TimelineEntryDto[];
  evidence: EvidenceRowDto[];
  changeEvents: ChangeEventRowDto[];
  dependencies: { edges: DependencyEdgeDto[] };
  citationRefByTimelineId?: Map<string, string>;
  citationRefByEvidenceId?: Map<string, string>;
}): KnowledgeGraphResult {
  const nodes: KnowledgeGraphNode[] = [];
  const edges: KnowledgeGraphEdge[] = [];
  const nodeIds = new Set<string>();

  function addNode(node: KnowledgeGraphNode) {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  }

  function addEdge(edge: KnowledgeGraphEdge) {
    edges.push(edge);
  }

  const primary = input.primaryService;
  if (primary) {
    addNode({ id: `service:${primary}`, kind: "service", label: primary });
  }

  if (input.alertName && primary) {
    const alertId = `alert:${input.alertName}`;
    addNode({ id: alertId, kind: "alert", label: input.alertName });
    addEdge({
      id: `edge:alert-${primary}`,
      source: alertId,
      target: `service:${primary}`,
      kind: "observed_on",
    });
  }

  for (const entry of input.timeline) {
    const ref = input.citationRefByTimelineId?.get(entry.id) ?? null;
    const nodeId = `timeline:${entry.id}`;
    addNode({
      id: nodeId,
      kind: "timeline",
      label: entry.title,
      occurredAt: entry.occurredAt,
      citationRef: ref,
    });

    if (primary) {
      addEdge({
        id: `edge:timeline-service:${entry.id}`,
        source: nodeId,
        target: `service:${primary}`,
        kind: "observed_on",
      });
    }

    if (entry.kind === "DEPLOY" || entry.kind === "CHANGE") {
      addEdge({
        id: `edge:deploy-cause:${entry.id}`,
        source: nodeId,
        target: primary ? `service:${primary}` : nodeId,
        kind: "caused_by",
      });
    }
  }

  for (const item of input.evidence) {
    const ref = input.citationRefByEvidenceId?.get(item.id) ?? null;
    const nodeId = `evidence:${item.id}`;
    addNode({
      id: nodeId,
      kind: "evidence",
      label: item.description.slice(0, 120),
      occurredAt: item.occurredAt,
      citationRef: ref,
    });

    if (item.timelineEntryId) {
      addEdge({
        id: `edge:evidence-timeline:${item.id}`,
        source: nodeId,
        target: `timeline:${item.timelineEntryId}`,
        kind: "correlates_with",
      });
    }
  }

  for (const event of input.changeEvents) {
    const kind = event.type === "deployment" || event.type === "commit" ? "deploy" : "change";
    const nodeId = `change:${event.id}`;
    addNode({
      id: nodeId,
      kind,
      label: `${event.type}${event.service ? ` · ${event.service}` : ""}`,
      occurredAt: event.occurredAt,
    });

    const targetService = event.service ?? primary;
    if (targetService) {
      const serviceNodeId = `service:${targetService}`;
      if (!nodeIds.has(serviceNodeId)) {
        addNode({ id: serviceNodeId, kind: "service", label: targetService });
      }
      addEdge({
        id: `edge:change-service:${event.id}`,
        source: nodeId,
        target: serviceNodeId,
        kind: "deployed_to",
      });
    }
  }

  for (const dep of input.dependencies.edges) {
    const sourceId = `service:${dep.source}`;
    const targetId = `service:${dep.destination}`;
    addNode({ id: sourceId, kind: "service", label: dep.source });
    addNode({ id: targetId, kind: "service", label: dep.destination });
    addEdge({
      id: `edge:depends:${dep.id}`,
      source: sourceId,
      target: targetId,
      kind: "depends_on",
    });
  }

  const summary =
    nodes.length === 0
      ? "Knowledge graph will populate as timeline, evidence, and dependency data is collected."
      : `${nodes.length} nodes · ${edges.length} relationships across services, alerts, deploys, and evidence citations.`;

  return { summary, nodes, edges };
}
