import { and, desc, eq, ilike, inArray, or, sql } from "@repo/database";
import { db } from "@repo/database";
import {
  investigationEmbeddingsTable,
  investigationsTable,
  type SelectInvestigation,
} from "@repo/database/schema";

import { shortInvestigationId } from "../signoz/webhook-parser";
import {
  canAccessInvestigation,
  type InvestigationAccessContext,
} from "./access";
import { buildInvestigationAccessFilter } from "./access-filter";
import { loadInvestigationAccessContext } from "./access-context";
import {
  loadInvestigationEmbedding,
  rankEmbeddingCandidates,
} from "./embeddings";
import type { InvestigationListItem } from "./types";

function toListItem(row: SelectInvestigation): InvestigationListItem {
  return {
    id: row.id,
    shortId: shortInvestigationId(row.id),
    title: row.title,
    status: row.status,
    caseStatus: row.caseStatus ?? "open",
    severity: row.severity,
    affectedServices: row.affectedServices ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

function escapeLike(value: string) {
  return value.replace(/[%_\\]/g, "\\$&");
}

export type InvestigationListFilters = {
  query?: string;
  severity?: string;
  pipelineStatus?: "building" | "ready" | "failed";
  caseStatus?: "open" | "investigating" | "monitoring" | "resolved";
};

function applyListFilters(filters?: InvestigationListFilters) {
  const clauses = [];
  if (filters?.severity) {
    clauses.push(eq(investigationsTable.severity, filters.severity));
  }
  if (filters?.pipelineStatus) {
    clauses.push(eq(investigationsTable.status, filters.pipelineStatus));
  }
  if (filters?.caseStatus) {
    clauses.push(eq(investigationsTable.caseStatus, filters.caseStatus));
  }
  return clauses;
}

/** Lists or searches investigation cases with org-scoped access control. */
export async function listInvestigations(
  ctx: InvestigationAccessContext,
  limit = 50,
  filters?: InvestigationListFilters,
): Promise<InvestigationListItem[]> {
  const trimmedQuery = filters?.query?.trim();
  const filterClauses = applyListFilters(filters);
  const access = buildInvestigationAccessFilter(ctx);

  if (trimmedQuery) {
    const pattern = `%${escapeLike(trimmedQuery)}%`;

    const metadataMatches = await db
      .select({ id: investigationsTable.id })
      .from(investigationsTable)
      .where(
        and(
          access,
          ...filterClauses,
          or(
            ilike(investigationsTable.title, pattern),
            ilike(investigationsTable.incidentId, pattern),
            ilike(investigationsTable.primaryService, pattern),
            ilike(investigationsTable.alertName, pattern),
            ilike(investigationsTable.summary, pattern),
          ),
        ),
      )
      .limit(limit);

    const timelineMatches = await db.execute<{ investigation_id: string }>(sql`
      SELECT DISTINCT investigation_id
      FROM investigation_timeline_entries
      WHERE to_tsvector('english', coalesce(title, '') || ' ' || coalesce(detail, ''))
        @@ plainto_tsquery('english', ${trimmedQuery})
      LIMIT ${limit}
    `);

    const timelineRows = Array.isArray(timelineMatches)
      ? timelineMatches
      : ((timelineMatches as { rows?: { investigation_id: string }[] }).rows ?? []);

    const ids = new Set<string>();
    for (const row of metadataMatches) ids.add(row.id);
    for (const row of timelineRows) ids.add(row.investigation_id);

    if (ids.size === 0) return [];

    const rows = await db
      .select()
      .from(investigationsTable)
      .where(and(access, inArray(investigationsTable.id, [...ids]), ...filterClauses))
      .orderBy(desc(investigationsTable.createdAt))
      .limit(limit);

    return rows.map(toListItem);
  }

  const rows = await db
    .select()
    .from(investigationsTable)
    .where(and(access, ...filterClauses))
    .orderBy(desc(investigationsTable.createdAt))
    .limit(limit);

  return rows.map(toListItem);
}

/** Full-text + metadata search across investigation cases (Feature #59). */
export async function searchInvestigations(
  ctx: InvestigationAccessContext,
  query: string,
  limit = 50,
): Promise<InvestigationListItem[]> {
  return listInvestigations(ctx, limit, { query });
}

export type SimilarInvestigationMatch = InvestigationListItem & {
  similarityScore: number;
  matchReasons: string[];
};

function scoreHeuristicSimilarity(current: SelectInvestigation, row: SelectInvestigation) {
  let score = 0;
  const reasons: string[] = [];

  const currentServices = new Set([
    ...(current.affectedServices ?? []),
    ...(current.primaryService ? [current.primaryService] : []),
  ]);

  const rowServices = new Set([
    ...(row.affectedServices ?? []),
    ...(row.primaryService ? [row.primaryService] : []),
  ]);

  for (const service of currentServices) {
    if (rowServices.has(service)) {
      score += 40;
      reasons.push(`Same service: ${service}`);
      break;
    }
  }

  if (current.alertName && row.alertName && current.alertName === row.alertName) {
    score += 35;
    reasons.push(`Same alert: ${row.alertName}`);
  }

  if (current.severity && row.severity && current.severity === row.severity) {
    score += 10;
    reasons.push(`Same severity: ${row.severity}`);
  }

  if (current.status === "ready" && row.status === "ready") {
    score += 5;
  }

  return { score, reasons };
}

async function findSimilarByEmbedding(
  ctx: InvestigationAccessContext,
  current: SelectInvestigation,
  investigationId: string,
  limit: number,
): Promise<SimilarInvestigationMatch[] | null> {
  const baseEmbedding = await loadInvestigationEmbedding(investigationId);
  if (!baseEmbedding) return null;

  const rows = await db
    .select({
      investigation: investigationsTable,
      embedding: investigationEmbeddingsTable.embedding,
    })
    .from(investigationEmbeddingsTable)
    .innerJoin(
      investigationsTable,
      eq(investigationEmbeddingsTable.investigationId, investigationsTable.id),
    )
    .where(
      and(
        buildInvestigationAccessFilter(ctx),
        sql`${investigationsTable.id} <> ${investigationId}`,
      ),
    )
    .orderBy(desc(investigationsTable.createdAt))
    .limit(100);

  const ranked = rankEmbeddingCandidates(
    baseEmbedding.embedding,
    rows.map((row) => ({
      investigationId: row.investigation.id,
      embedding: row.embedding,
    })),
    limit,
  );

  if (ranked.length === 0) return null;

  const rowById = new Map(rows.map((row) => [row.investigation.id, row.investigation]));

  return ranked
    .map((item) => {
      const investigation = rowById.get(item.investigationId);
      if (!investigation) return null;

      const heuristic = scoreHeuristicSimilarity(current, investigation);
      return {
        ...toListItem(investigation),
        similarityScore: item.similarityScore,
        matchReasons: [
          `Semantic similarity ${item.similarityScore}%`,
          ...heuristic.reasons.slice(0, 2),
        ],
      };
    })
    .filter((item): item is SimilarInvestigationMatch => item !== null);
}

/** Finds similar cases via embeddings first, then heuristic service/alert matching. */
export async function findSimilarInvestigations(
  userId: string,
  investigationId: string,
  limit = 5,
): Promise<SimilarInvestigationMatch[]> {
  const ctx = await loadInvestigationAccessContext(userId);

  const [current] = await db
    .select()
    .from(investigationsTable)
    .where(eq(investigationsTable.id, investigationId))
    .limit(1);

  if (!current || !canAccessInvestigation(current, ctx)) return [];

  const embeddingMatches = await findSimilarByEmbedding(ctx, current, investigationId, limit);
  if (embeddingMatches && embeddingMatches.length > 0) {
    return embeddingMatches;
  }

  const candidates = await db
    .select()
    .from(investigationsTable)
    .where(
      and(buildInvestigationAccessFilter(ctx), sql`${investigationsTable.id} <> ${investigationId}`),
    )
    .orderBy(desc(investigationsTable.createdAt))
    .limit(100);

  const scored: SimilarInvestigationMatch[] = [];

  for (const row of candidates) {
    const { score, reasons } = scoreHeuristicSimilarity(current, row);
    if (score >= 35) {
      scored.push({
        ...toListItem(row),
        similarityScore: Math.min(100, score),
        matchReasons: reasons,
      });
    }
  }

  return scored.sort((a, b) => b.similarityScore - a.similarityScore).slice(0, limit);
}
