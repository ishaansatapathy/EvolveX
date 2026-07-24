import { buildServiceMapDeepCorrelation } from "../telemetry-intelligence/service-map/deep-correlation";
import type {
  ChangeEventRowDto,
  DependencyEdgeDto,
  RuntimeSignalRowDto,
  ServiceNodeDto,
  TimelineEntryDto,
} from "./types";

export type ServiceMapNodeInsight = {
  service: string;
  role: "primary" | "upstream" | "downstream";
  healthy: boolean;
  latencyMs: number | null;
  evidenceCount: number;
  changeCount: number;
};

export type ServiceMapEdgeInsight = {
  source: string;
  destination: string;
  healthy: boolean;
  latencyMs: number | null;
  evidenceOnPath: number;
};

export type ServiceMapPropagationPath = {
  id: string;
  direction: "upstream_cause" | "downstream_effect";
  services: string[];
  score: number;
  confidence: "high" | "medium" | "low";
  summary: string;
};

export type ServiceMapDeepCorrelationResult = {
  summary: string;
  primaryService: string;
  upstream: string[];
  downstream: string[];
  affectedServices: string[];
  graphDepth: number;
  liveSigNozSynced: boolean;
  nodes: ServiceMapNodeInsight[];
  edges: ServiceMapEdgeInsight[];
  propagationPaths: ServiceMapPropagationPath[];
  suspectServices: Array<{ service: string; score: number; reasons: string[] }>;
};

function countTimelineEvidence(service: string, timeline: TimelineEntryDto[]) {
  const needle = service.toLowerCase();
  return timeline.filter((entry) => {
    const haystack = `${entry.title} ${entry.detail} ${entry.source ?? ""}`.toLowerCase();
    return haystack.includes(needle);
  }).length;
}

function countChangeEvents(service: string, changeEvents: ChangeEventRowDto[]) {
  const needle = service.toLowerCase();
  return changeEvents.filter((event) => (event.service ?? "").toLowerCase().includes(needle)).length;
}

function maxLatency(service: string, runtimeSignals: RuntimeSignalRowDto[]) {
  const matches = runtimeSignals.filter((signal) => signal.service === service);
  if (matches.length === 0) return null;
  return Math.max(...matches.map((signal) => signal.latencyMs ?? signal.p99Ms ?? signal.p95Ms ?? 0));
}

function nodeMeta(name: string, nodes: ServiceNodeDto[]) {
  const node = nodes.find((item) => item.name === name);
  return {
    healthy: node?.healthy ?? true,
    latencyMs: node?.latencyMs ?? null,
  };
}

function scorePath(services: string[], timeline: TimelineEntryDto[], changeEvents: ChangeEventRowDto[]) {
  let score = 20;
  let evidenceHits = 0;
  let changeHits = 0;

  for (const service of services) {
    const evidence = countTimelineEvidence(service, timeline);
    const changes = countChangeEvents(service, changeEvents);
    evidenceHits += evidence;
    changeHits += changes;
    if (evidence > 0) score += 15;
    if (changes > 0) score += 20;
  }

  if (changeHits > 0) score += 10;
  return { score: Math.min(score, 100), evidenceHits, changeHits };
}

function confidenceFromScore(score: number): "high" | "medium" | "low" {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

/** Feature #6 — SigNoz service map deep correlation for investigations. */
export async function computeServiceMapDeepCorrelation(input: {
  primaryService: string | null;
  organizationId?: string | null;
  incidentWindowStart?: Date | null;
  incidentWindowEnd?: Date | null;
  dependencies: { nodes: ServiceNodeDto[]; edges: DependencyEdgeDto[] };
  timeline: TimelineEntryDto[];
  runtimeSignals: RuntimeSignalRowDto[];
  changeEvents: ChangeEventRowDto[];
}): Promise<ServiceMapDeepCorrelationResult | null> {
  const primary = input.primaryService?.trim();
  if (!primary) {
    return null;
  }

  const endMs = input.incidentWindowEnd?.getTime() ?? Date.now();
  const startMs = input.incidentWindowStart?.getTime() ?? endMs - 60 * 60 * 1000;

  let snapshot = {
    primaryService: primary,
    upstream: [] as string[],
    downstream: [] as string[],
    affectedServices: [primary],
    propagationPaths: [] as string[][],
  };
  let liveSigNozSynced = false;

  try {
    snapshot = await buildServiceMapDeepCorrelation({
      primaryService: primary,
      organizationId: input.organizationId ?? null,
      startMs,
      endMs,
    });
    liveSigNozSynced = snapshot.upstream.length > 0 || snapshot.downstream.length > 0;
  } catch {
    // Fall back to persisted graph only.
  }

  if (snapshot.upstream.length === 0 && snapshot.downstream.length === 0) {
    for (const edge of input.dependencies.edges) {
      if (edge.destination === primary) snapshot.upstream.push(edge.source);
      if (edge.source === primary) snapshot.downstream.push(edge.destination);
    }
    snapshot.upstream = [...new Set(snapshot.upstream)];
    snapshot.downstream = [...new Set(snapshot.downstream)];
    snapshot.affectedServices = [...new Set([primary, ...snapshot.upstream, ...snapshot.downstream])];
  }

  const nodes: ServiceMapNodeInsight[] = snapshot.affectedServices.map((service) => {
    const meta = nodeMeta(service, input.dependencies.nodes);
    const role =
      service === primary ? "primary" : snapshot.upstream.includes(service) ? "upstream" : "downstream";
    return {
      service,
      role,
      healthy: meta.healthy,
      latencyMs: maxLatency(service, input.runtimeSignals) ?? meta.latencyMs,
      evidenceCount: countTimelineEvidence(service, input.timeline),
      changeCount: countChangeEvents(service, input.changeEvents),
    };
  });

  const edges: ServiceMapEdgeInsight[] = input.dependencies.edges
    .filter(
      (edge) =>
        snapshot.affectedServices.includes(edge.source) && snapshot.affectedServices.includes(edge.destination),
    )
    .map((edge) => ({
      source: edge.source,
      destination: edge.destination,
      healthy: edge.healthy,
      latencyMs: edge.latencyMs,
      evidenceOnPath:
        countTimelineEvidence(edge.source, input.timeline) + countTimelineEvidence(edge.destination, input.timeline),
    }));

  const propagationPaths: ServiceMapPropagationPath[] = [];

  for (const [index, pathServices] of snapshot.propagationPaths.entries()) {
    if (pathServices.length < 2) continue;
    const direction: ServiceMapPropagationPath["direction"] = pathServices[0] === primary
      ? "downstream_effect"
      : "upstream_cause";
    const { score } = scorePath(pathServices, input.timeline, input.changeEvents);
    propagationPaths.push({
      id: `path-${index + 1}`,
      direction,
      services: pathServices,
      score,
      confidence: confidenceFromScore(score),
      summary:
        direction === "upstream_cause"
          ? `Upstream propagation: ${pathServices.join(" → ")}`
          : `Downstream blast: ${pathServices.join(" → ")}`,
    });
  }

  propagationPaths.sort((a, b) => b.score - a.score);

  const suspectServices = nodes
    .filter((node) => node.service !== primary)
    .map((node) => {
      let score = 0;
      const reasons: string[] = [];
      if (!node.healthy) {
        score += 35;
        reasons.push("Unhealthy in service map");
      }
      if (node.evidenceCount > 0) {
        score += node.evidenceCount * 10;
        reasons.push(`${node.evidenceCount} timeline signal(s)`);
      }
      if (node.changeCount > 0) {
        score += node.changeCount * 15;
        reasons.push(`${node.changeCount} change event(s)`);
      }
      if (node.latencyMs != null && node.latencyMs >= 500) {
        score += 20;
        reasons.push(`Elevated latency (${node.latencyMs}ms)`);
      }
      if (node.role === "upstream") {
        score += 10;
        reasons.push("Direct upstream caller");
      }
      return { service: node.service, score: Math.min(score, 100), reasons };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const graphDepth = Math.max(snapshot.upstream.length, snapshot.downstream.length, edges.length > 0 ? 1 : 0);

  const summary =
    graphDepth === 0
      ? `${primary} has no dependency edges yet — SigNoz service map sync runs during pipeline.`
      : suspectServices.length > 0
        ? `Service map depth ${graphDepth} — top suspect: ${suspectServices[0]!.service} (${suspectServices[0]!.score}% correlation)`
        : `Service map depth ${graphDepth} — ${snapshot.affectedServices.length} services in blast neighborhood`;

  return {
    summary,
    primaryService: primary,
    upstream: snapshot.upstream,
    downstream: snapshot.downstream,
    affectedServices: snapshot.affectedServices,
    graphDepth,
    liveSigNozSynced,
    nodes,
    edges,
    propagationPaths,
    suspectServices,
  };
}
