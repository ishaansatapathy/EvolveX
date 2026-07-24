import { resolveSignozConfig } from "../../organization/integrations";
import { fetchSignozDependencies } from "../../signoz/service-map";
import { loadServiceGraphNeighborhood } from "../../investigation/service-graph";
import type { ServiceMapCorrelationSnapshot } from "../types";

/** Feature #6 — traverse dependency graph for investigation + sampling targets. */
export async function buildServiceMapDeepCorrelation(input: {
  primaryService: string;
  organizationId: string | null;
  startMs?: number;
  endMs?: number;
}): Promise<ServiceMapCorrelationSnapshot> {
  const endMs = input.endMs ?? Date.now();
  const startMs = input.startMs ?? endMs - 60 * 60 * 1000;

  const neighborhood = await loadServiceGraphNeighborhood(input.primaryService, 3);
  const nodeNames = neighborhood.nodes.map((node) => node.name);

  const upstream = new Set<string>();
  const downstream = new Set<string>();

  for (const edge of neighborhood.edges) {
    if (edge.destination === input.primaryService) upstream.add(edge.source);
    if (edge.source === input.primaryService) downstream.add(edge.destination);
  }

  const config = (await resolveSignozConfig(input.organizationId)) ?? null;
  if (config) {
    const liveEdges = await fetchSignozDependencies({
      service: input.primaryService,
      config,
      startMs,
      endMs,
    });
    for (const edge of liveEdges) {
      if (edge.destination === input.primaryService) upstream.add(edge.source);
      if (edge.source === input.primaryService) downstream.add(edge.destination);
    }
  }

  const affectedServices = [...new Set([input.primaryService, ...upstream, ...downstream])];
  const propagationPaths: string[][] = [];

  for (const up of upstream) {
    propagationPaths.push([up, input.primaryService, ...downstream].slice(0, 4));
  }
  if (propagationPaths.length === 0 && downstream.size > 0) {
    propagationPaths.push([input.primaryService, ...downstream].slice(0, 4));
  }

  return {
    primaryService: input.primaryService,
    upstream: [...upstream],
    downstream: [...downstream],
    affectedServices,
    propagationPaths,
  };
}

export function graphDepthFromCorrelation(correlation: ServiceMapCorrelationSnapshot) {
  return Math.max(correlation.upstream.length, correlation.downstream.length, 1);
}
