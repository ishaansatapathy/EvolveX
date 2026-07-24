import type { DependencyEdgeDto, RuntimeSignalRowDto, ServiceNodeDto, TimelineEntryDto } from "./types";

export type BlastRadiusImpact = {
  service: string;
  direction: "origin" | "downstream" | "upstream";
  impactScore: number;
  healthy: boolean;
  latencyMs: number | null;
  evidenceCount: number;
  reasons: string[];
};

export type BlastRadiusResult = {
  summary: string;
  primaryService: string | null;
  totalAffected: number;
  impacts: BlastRadiusImpact[];
};

function buildAdjacency(edges: DependencyEdgeDto[]) {
  const downstream = new Map<string, Set<string>>();
  const upstream = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (!downstream.has(edge.source)) downstream.set(edge.source, new Set());
    downstream.get(edge.source)!.add(edge.destination);

    if (!upstream.has(edge.destination)) upstream.set(edge.destination, new Set());
    upstream.get(edge.destination)!.add(edge.source);
  }

  return { downstream, upstream };
}

function collectReachable(start: string, adjacency: Map<string, Set<string>>) {
  const visited = new Set<string>();
  const queue = [start];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }

  return visited;
}

function countEvidenceForService(service: string, timeline: TimelineEntryDto[]) {
  const needle = service.toLowerCase();
  return timeline.filter((entry) => {
    const haystack = `${entry.title} ${entry.detail} ${entry.source ?? ""}`.toLowerCase();
    return haystack.includes(needle);
  }).length;
}

function maxLatencyForService(service: string, runtimeSignals: RuntimeSignalRowDto[]) {
  const matches = runtimeSignals.filter((signal) => signal.service === service);
  if (matches.length === 0) return null;
  return Math.max(...matches.map((signal) => signal.latencyMs ?? signal.p99Ms ?? signal.p95Ms ?? 0));
}

/** Computes downstream/upstream blast radius from real dependency graph + collected evidence. */
export function computeBlastRadius(input: {
  primaryService: string | null;
  dependencies: { nodes: ServiceNodeDto[]; edges: DependencyEdgeDto[] };
  timeline: TimelineEntryDto[];
  runtimeSignals: RuntimeSignalRowDto[];
}): BlastRadiusResult {
  const primary = input.primaryService;
  if (!primary) {
    return {
      summary: "No primary service identified — blast radius unavailable until SigNoz alert metadata is collected.",
      primaryService: null,
      totalAffected: 0,
      impacts: [],
    };
  }

  const nodeByName = new Map(input.dependencies.nodes.map((node) => [node.name, node]));
  const { downstream, upstream } = buildAdjacency(input.dependencies.edges);

  const downstreamReach = collectReachable(primary, downstream);
  const upstreamReach = collectReachable(primary, upstream);

  const impacts: BlastRadiusImpact[] = [];

  for (const service of new Set([...downstreamReach, ...upstreamReach, primary])) {
    const node = nodeByName.get(service);
    const direction =
      service === primary ? "origin" : downstreamReach.has(service) ? "downstream" : "upstream";

    let impactScore = service === primary ? 100 : direction === "downstream" ? 55 : 35;
    const reasons: string[] = [];

    if (service === primary) {
      reasons.push("Alert origin service");
    } else if (direction === "downstream") {
      reasons.push("Downstream dependency of origin");
    } else {
      reasons.push("Upstream dependency feeding origin");
    }

    const evidenceCount = countEvidenceForService(service, input.timeline);
    if (evidenceCount > 0) {
      impactScore += Math.min(25, evidenceCount * 5);
      reasons.push(`${evidenceCount} timeline signal(s)`);
    }

    const signalLatency = maxLatencyForService(service, input.runtimeSignals);
    const latencyMs = node?.latencyMs ?? signalLatency;
    if (latencyMs != null && latencyMs >= 500) {
      impactScore += 15;
      reasons.push(`Elevated latency (${latencyMs}ms)`);
    }

    if (node && !node.healthy) {
      impactScore += 20;
      reasons.push("Unhealthy in SigNoz service map");
    }

    impacts.push({
      service,
      direction,
      impactScore: Math.min(100, impactScore),
      healthy: node?.healthy ?? true,
      latencyMs: latencyMs ?? null,
      evidenceCount,
      reasons,
    });
  }

  impacts.sort((a, b) => b.impactScore - a.impactScore);

  const affected = impacts.filter((item) => item.direction !== "origin").length;
  const topDownstream = impacts.find((item) => item.direction === "downstream");

  const summary =
    affected === 0
      ? `${primary} has no persisted dependency edges yet — run pipeline or open Service Map after SigNoz ingestion.`
      : topDownstream
        ? `${affected} dependent service(s) may be affected. Highest downstream risk: ${topDownstream.service} (${topDownstream.impactScore}% impact).`
        : `${affected} connected service(s) in the dependency neighborhood around ${primary}.`;

  return {
    summary,
    primaryService: primary,
    totalAffected: affected,
    impacts,
  };
}
