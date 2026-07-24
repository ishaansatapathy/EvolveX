import { eq, inArray, or } from "@repo/database";
import { db } from "@repo/database";
import { serviceDependenciesTable, servicesTable } from "@repo/database/schema";

import type { DependencyEdgeDto, ServiceNodeDto } from "./types";

/** Loads a multi-hop service neighborhood from persisted SigNoz dependency edges. */
export async function loadServiceGraphNeighborhood(
  primaryService: string,
  maxHops = 3,
): Promise<{ nodes: ServiceNodeDto[]; edges: DependencyEdgeDto[] }> {
  const [root] = await db
    .select()
    .from(servicesTable)
    .where(eq(servicesTable.name, primaryService))
    .limit(1);

  if (!root) {
    return { nodes: [], edges: [] };
  }

  const nodeById = new Map<string, ServiceNodeDto>();
  const edgeById = new Map<string, DependencyEdgeDto>();

  function addNode(row: { id: string; name: string; healthy: boolean; latencyMs: number | null }) {
    nodeById.set(row.id, {
      id: row.id,
      name: row.name,
      healthy: row.healthy,
      latencyMs: row.latencyMs,
    });
  }

  addNode(root);

  let frontier = new Set([root.id]);

  for (let hop = 0; hop < maxHops && frontier.size > 0; hop++) {
    const frontierIds = [...frontier];
    frontier = new Set();

    const edgeRows = await db
      .select()
      .from(serviceDependenciesTable)
      .where(
        or(
          inArray(serviceDependenciesTable.sourceServiceId, frontierIds),
          inArray(serviceDependenciesTable.destinationServiceId, frontierIds),
        ),
      );

    const neighborIds = new Set<string>();
    for (const edge of edgeRows) {
      neighborIds.add(edge.sourceServiceId);
      neighborIds.add(edge.destinationServiceId);
    }

    if (neighborIds.size === 0) break;

    const serviceRows = await db
      .select()
      .from(servicesTable)
      .where(inArray(servicesTable.id, [...neighborIds]));

    const nameById = new Map(serviceRows.map((row) => [row.id, row.name]));

    for (const row of serviceRows) {
      if (!nodeById.has(row.id)) {
        addNode(row);
        if (hop + 1 < maxHops) frontier.add(row.id);
      }
    }

    for (const edge of edgeRows) {
      const sourceName = nameById.get(edge.sourceServiceId) ?? nodeById.get(edge.sourceServiceId)?.name;
      const destinationName =
        nameById.get(edge.destinationServiceId) ?? nodeById.get(edge.destinationServiceId)?.name;
      if (!sourceName || !destinationName) continue;

      edgeById.set(edge.id, {
        id: edge.id,
        source: sourceName,
        destination: destinationName,
        healthy: edge.healthy,
        latencyMs: edge.latencyMs,
      });
    }
  }

  return {
    nodes: [...nodeById.values()],
    edges: [...edgeById.values()],
  };
}
