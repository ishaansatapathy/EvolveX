import type {
  ChangeEventRowDto,
  DependencyEdgeDto,
  RuntimeSignalRowDto,
  ServiceNodeDto,
  TimelineEntryDto,
} from "./types";

export type CrossServiceHop = {
  service: string;
  role: "origin" | "upstream" | "downstream";
  evidenceCount: number;
  unhealthy: boolean;
  latencyMs: number | null;
  citationRefs: string[];
};

export type CrossServicePath = {
  id: string;
  direction: "upstream_cause" | "downstream_effect";
  services: string[];
  score: number;
  confidence: "high" | "medium" | "low";
  summary: string;
  hops: CrossServiceHop[];
};

export type CrossServiceRcaResult = {
  summary: string;
  primaryService: string | null;
  paths: CrossServicePath[];
};

function buildAdjacency(edges: DependencyEdgeDto[]) {
  const downstream = new Map<string, string[]>();
  const upstream = new Map<string, string[]>();

  for (const edge of edges) {
    if (!downstream.has(edge.source)) downstream.set(edge.source, []);
    downstream.get(edge.source)!.push(edge.destination);

    if (!upstream.has(edge.destination)) upstream.set(edge.destination, []);
    upstream.get(edge.destination)!.push(edge.source);
  }

  return { downstream, upstream };
}

function countEvidenceForService(service: string, timeline: TimelineEntryDto[]) {
  const needle = service.toLowerCase();
  return timeline.filter((entry) => {
    const haystack = `${entry.title} ${entry.detail} ${entry.source ?? ""}`.toLowerCase();
    return haystack.includes(needle);
  });
}

function maxLatencyForService(service: string, runtimeSignals: RuntimeSignalRowDto[]) {
  const matches = runtimeSignals.filter((signal) => signal.service === service);
  if (matches.length === 0) return null;
  return Math.max(...matches.map((signal) => signal.latencyMs ?? signal.p99Ms ?? signal.p95Ms ?? 0));
}

function hasDeployForService(service: string, changeEvents: ChangeEventRowDto[]) {
  return changeEvents.some((event) => {
    const eventService = typeof event.service === "string" ? event.service.toLowerCase() : "";
    return eventService === service.toLowerCase() || event.type === "deployment" || event.type === "commit";
  });
}

function enumerateUpstreamPaths(primary: string, upstream: Map<string, string[]>, maxHops: number): string[][] {
  const paths: string[][] = [];

  function walk(currentPath: string[], depth: number) {
    if (depth >= maxHops) return;
    const tip = currentPath[currentPath.length - 1]!;
    const callers = upstream.get(tip) ?? [];

    if (callers.length === 0) {
      if (currentPath.length > 1) paths.push([...currentPath].reverse());
      return;
    }

    for (const caller of callers) {
      if (currentPath.includes(caller)) continue;
      const extended = [...currentPath, caller];
      paths.push([...extended].reverse());
      walk(extended, depth + 1);
    }
  }

  walk([primary], 0);
  return dedupePaths(paths);
}

function enumerateDownstreamPaths(primary: string, downstream: Map<string, string[]>, maxHops: number): string[][] {
  const paths: string[][] = [];

  function walk(currentPath: string[], depth: number) {
    if (depth >= maxHops) return;
    const tip = currentPath[currentPath.length - 1]!;
    const deps = downstream.get(tip) ?? [];

    if (deps.length === 0) {
      if (currentPath.length > 1) paths.push([...currentPath]);
      return;
    }

    for (const dep of deps) {
      if (currentPath.includes(dep)) continue;
      const extended = [...currentPath, dep];
      paths.push([...extended]);
      walk(extended, depth + 1);
    }
  }

  walk([primary], 0);
  return dedupePaths(paths);
}

function dedupePaths(paths: string[][]) {
  const seen = new Set<string>();
  const unique: string[][] = [];

  for (const path of paths) {
    const key = path.join("->");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(path);
  }

  return unique;
}

function scoreToConfidence(score: number): "high" | "medium" | "low" {
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function buildHops(input: {
  services: string[];
  primary: string;
  direction: CrossServicePath["direction"];
  nodeByName: Map<string, ServiceNodeDto>;
  timeline: TimelineEntryDto[];
  runtimeSignals: RuntimeSignalRowDto[];
  citationRefByTimelineId?: Map<string, string>;
}): CrossServiceHop[] {
  return input.services.map((service) => {
    const matchingEntries = countEvidenceForService(service, input.timeline);
    const citationRefs: string[] = [];

    for (const entry of matchingEntries) {
      const ref = input.citationRefByTimelineId?.get(entry.id);
      if (ref && !citationRefs.includes(ref)) citationRefs.push(ref);
    }

    const node = input.nodeByName.get(service);
    const role =
      service === input.primary
        ? "origin"
        : input.direction === "upstream_cause"
          ? service === input.services[0]
            ? "upstream"
            : "upstream"
          : service === input.services[input.services.length - 1]
            ? "downstream"
            : "downstream";

    return {
      service,
      role: service === input.primary ? "origin" : role,
      evidenceCount: matchingEntries.length,
      unhealthy: node ? !node.healthy : false,
      latencyMs: node?.latencyMs ?? maxLatencyForService(service, input.runtimeSignals),
      citationRefs: citationRefs.slice(0, 4),
    };
  });
}

function scorePath(input: {
  services: string[];
  primary: string;
  direction: CrossServicePath["direction"];
  hops: CrossServiceHop[];
  edges: DependencyEdgeDto[];
  changeEvents: ChangeEventRowDto[];
}): number {
  let score = 30 + input.services.length * 8;

  for (const hop of input.hops) {
    if (hop.evidenceCount > 0) score += Math.min(20, hop.evidenceCount * 6);
    if (hop.unhealthy) score += 18;
    if (hop.latencyMs != null && hop.latencyMs >= 500) score += 12;
    if (hop.citationRefs.length > 0) score += 5;
  }

  const rootService = input.direction === "upstream_cause" ? input.services[0] : input.primary;
  if (rootService && hasDeployForService(rootService, input.changeEvents)) {
    score += 20;
  }

  for (let index = 0; index < input.services.length - 1; index += 1) {
    const from = input.services[index]!;
    const to = input.services[index + 1]!;
    const edge = input.edges.find((item) => item.source === from && item.destination === to);
    if (edge && !edge.healthy) score += 10;
    if (edge?.latencyMs != null && edge.latencyMs >= 500) score += 8;
  }

  if (input.direction === "upstream_cause" && input.services[0] !== input.primary) {
    score += 10;
  }

  return Math.min(100, score);
}

function summarizePath(services: string[], direction: CrossServicePath["direction"], score: number) {
  const chain = services.join(" → ");
  if (direction === "upstream_cause") {
    return `Failure may have propagated ${chain} before surfacing on ${services[services.length - 1]} (${score}% confidence).`;
  }
  return `Degradation at ${services[0]} may have affected downstream path ${chain} (${score}% confidence).`;
}

/** Traverses the service graph to rank upstream/downstream propagation paths (Feature #20). */
export function computeCrossServiceRca(input: {
  primaryService: string | null;
  dependencies: { nodes: ServiceNodeDto[]; edges: DependencyEdgeDto[] };
  timeline: TimelineEntryDto[];
  runtimeSignals: RuntimeSignalRowDto[];
  changeEvents: ChangeEventRowDto[];
  citationRefByTimelineId?: Map<string, string>;
  maxHops?: number;
  limit?: number;
}): CrossServiceRcaResult {
  const primary = input.primaryService;
  if (!primary) {
    return {
      summary: "No primary service — cross-service RCA requires SigNoz alert metadata.",
      primaryService: null,
      paths: [],
    };
  }

  if (input.dependencies.edges.length === 0) {
    return {
      summary: `${primary} has no dependency edges yet — open Service Map after SigNoz ingestion to enable cross-service RCA.`,
      primaryService: primary,
      paths: [],
    };
  }

  const maxHops = input.maxHops ?? 4;
  const { downstream, upstream } = buildAdjacency(input.dependencies.edges);
  const nodeByName = new Map(input.dependencies.nodes.map((node) => [node.name, node]));

  const upstreamPaths = enumerateUpstreamPaths(primary, upstream, maxHops);
  const downstreamPaths = enumerateDownstreamPaths(primary, downstream, maxHops);

  const paths: CrossServicePath[] = [];

  for (const services of upstreamPaths) {
    const hops = buildHops({
      services,
      primary,
      direction: "upstream_cause",
      nodeByName,
      timeline: input.timeline,
      runtimeSignals: input.runtimeSignals,
      citationRefByTimelineId: input.citationRefByTimelineId,
    });
    const score = scorePath({
      services,
      primary,
      direction: "upstream_cause",
      hops,
      edges: input.dependencies.edges,
      changeEvents: input.changeEvents,
    });

    paths.push({
      id: `upstream-${services.join("-")}`,
      direction: "upstream_cause",
      services,
      score,
      confidence: scoreToConfidence(score),
      summary: summarizePath(services, "upstream_cause", score),
      hops,
    });
  }

  for (const services of downstreamPaths) {
    const hops = buildHops({
      services,
      primary,
      direction: "downstream_effect",
      nodeByName,
      timeline: input.timeline,
      runtimeSignals: input.runtimeSignals,
      citationRefByTimelineId: input.citationRefByTimelineId,
    });
    const score = scorePath({
      services,
      primary,
      direction: "downstream_effect",
      hops,
      edges: input.dependencies.edges,
      changeEvents: input.changeEvents,
    });

    paths.push({
      id: `downstream-${services.join("-")}`,
      direction: "downstream_effect",
      services,
      score,
      confidence: scoreToConfidence(score),
      summary: summarizePath(services, "downstream_effect", score),
      hops,
    });
  }

  paths.sort((a, b) => b.score - a.score);
  const topPaths = paths.slice(0, input.limit ?? 5);

  const topUpstream = topPaths.find((path) => path.direction === "upstream_cause");
  const summary =
    topPaths.length === 0
      ? `${primary} is isolated in the graph — no multi-hop propagation paths found.`
      : topUpstream
        ? `Most likely cross-service path: ${topUpstream.services.join(" → ")} (${topUpstream.confidence} confidence).`
        : `Top propagation path: ${topPaths[0]!.services.join(" → ")} (${topPaths[0]!.confidence} confidence).`;

  return {
    summary,
    primaryService: primary,
    paths: topPaths,
  };
}
