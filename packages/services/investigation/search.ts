import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "@repo/database";
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
  /** Feature #60 — filter by primary or affected service name */
  service?: string;
  /** Feature #60 — filter by SigNoz alert name */
  alertName?: string;
  /** Feature #60 — ISO date lower bound (inclusive) */
  dateFrom?: string;
  /** Feature #60 — ISO date upper bound (inclusive) */
  dateTo?: string;
  /** Feature #60 — investigations with timeline entries of this kind */
  timelineKind?: string;
};

export type InvestigationSearchMatchSource =
  | "title"
  | "short_id"
  | "service"
  | "alert"
  | "summary"
  | "timeline";

export type InvestigationSearchResult = InvestigationListItem & {
  primaryService: string | null;
  alertName: string | null;
  matchSources: InvestigationSearchMatchSource[];
  matchSnippet: string | null;
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
  if (filters?.service?.trim()) {
    const pattern = `%${escapeLike(filters.service.trim())}%`;
    clauses.push(
      or(
        ilike(investigationsTable.primaryService, pattern),
        sql`${investigationsTable.affectedServices}::text ilike ${pattern}`,
      ),
    );
  }
  if (filters?.alertName?.trim()) {
    clauses.push(ilike(investigationsTable.alertName, `%${escapeLike(filters.alertName.trim())}%`));
  }
  if (filters?.dateFrom) {
    const parsed = new Date(filters.dateFrom);
    if (!Number.isNaN(parsed.getTime())) {
      clauses.push(gte(investigationsTable.createdAt, parsed));
    }
  }
  if (filters?.dateTo) {
    const parsed = new Date(filters.dateTo);
    if (!Number.isNaN(parsed.getTime())) {
      parsed.setHours(23, 59, 59, 999);
      clauses.push(lte(investigationsTable.createdAt, parsed));
    }
  }
  return clauses;
}

function detectMetadataMatchSources(row: SelectInvestigation, query: string): InvestigationSearchMatchSource[] {
  const needle = query.toLowerCase();
  const sources: InvestigationSearchMatchSource[] = [];
  const shortId = shortInvestigationId(row.id).toLowerCase();

  if (row.title.toLowerCase().includes(needle)) sources.push("title");
  if (shortId.includes(needle.replace(/^inv-?/i, "")) || shortId.includes(needle)) sources.push("short_id");
  if (row.primaryService?.toLowerCase().includes(needle)) sources.push("service");
  if (row.alertName?.toLowerCase().includes(needle)) sources.push("alert");
  if (row.summary?.toLowerCase().includes(needle)) sources.push("summary");
  if ((row.affectedServices ?? []).some((service) => service.toLowerCase().includes(needle))) {
    if (!sources.includes("service")) sources.push("service");
  }

  return sources;
}

function toSearchResult(
  row: SelectInvestigation,
  query: string | undefined,
  timelineSnippets: Map<string, string>,
  timelineMatchedIds: Set<string>,
): InvestigationSearchResult {
  const matchSources = query ? detectMetadataMatchSources(row, query) : [];
  if (query && timelineMatchedIds.has(row.id) && !matchSources.includes("timeline")) {
    matchSources.push("timeline");
  }

  return {
    ...toListItem(row),
    primaryService: row.primaryService,
    alertName: row.alertName,
    matchSources,
    matchSnippet: timelineSnippets.get(row.id) ?? null,
  };
}

async function timelineKindInvestigationIds(kind: string, limit: number) {
  const rows = await db.execute<{ investigation_id: string }>(sql`
    SELECT DISTINCT investigation_id
    FROM investigation_timeline_entries
    WHERE kind = ${kind}
    LIMIT ${limit}
  `);
  return Array.isArray(rows) ? rows : ((rows as { rows?: { investigation_id: string }[] }).rows ?? []);
}

async function searchTimelineMatches(query: string, limit: number) {
  const rows = await db.execute<{ investigation_id: string; headline: string | null }>(sql`
    SELECT
      investigation_id,
      ts_headline(
        'english',
        coalesce(title, '') || ' ' || coalesce(detail, ''),
        plainto_tsquery('english', ${query}),
        'MaxWords=24, MinWords=8, StartSel=<<, StopSel=>>'
      ) AS headline
    FROM investigation_timeline_entries
    WHERE to_tsvector('english', coalesce(title, '') || ' ' || coalesce(detail, ''))
      @@ plainto_tsquery('english', ${query})
    ORDER BY occurred_at DESC
    LIMIT ${limit}
  `);

  const timelineRows = Array.isArray(rows)
    ? rows
    : ((rows as { rows?: { investigation_id: string; headline: string | null }[] }).rows ?? []);

  const snippets = new Map<string, string>();
  const matchedIds = new Set<string>();

  for (const row of timelineRows) {
    matchedIds.add(row.investigation_id);
    if (!snippets.has(row.investigation_id) && row.headline) {
      snippets.set(row.investigation_id, row.headline.replace(/<<|>>/g, ""));
    }
  }

  return { snippets, matchedIds };
}

/** Lists or searches investigation cases with org-scoped access control. */
export async function listInvestigations(
  ctx: InvestigationAccessContext,
  limit = 50,
  filters?: InvestigationListFilters,
): Promise<InvestigationListItem[]> {
  const rows = await queryInvestigationRows(ctx, limit, filters);
  return rows.map(toListItem);
}

async function queryInvestigationRows(
  ctx: InvestigationAccessContext,
  limit: number,
  filters?: InvestigationListFilters,
): Promise<SelectInvestigation[]> {
  const trimmedQuery = filters?.query?.trim();
  const filterClauses = applyListFilters(filters);
  const access = buildInvestigationAccessFilter(ctx);

  let timelineKindIds: Set<string> | null = null;
  if (filters?.timelineKind?.trim()) {
    const kindRows = await timelineKindInvestigationIds(filters.timelineKind.trim(), limit * 4);
    timelineKindIds = new Set(kindRows.map((row) => row.investigation_id));
    if (timelineKindIds.size === 0) return [];
  }

  function applyTimelineKindFilter(ids: Set<string>) {
    if (!timelineKindIds) return ids;
    return new Set([...ids].filter((id) => timelineKindIds!.has(id)));
  }

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
            sql`${investigationsTable.affectedServices}::text ilike ${pattern}`,
          ),
        ),
      )
      .limit(limit);

    const { matchedIds: timelineMatchedIds } = await searchTimelineMatches(trimmedQuery, limit);

    let ids = new Set<string>();
    for (const row of metadataMatches) ids.add(row.id);
    for (const id of timelineMatchedIds) ids.add(id);
    ids = applyTimelineKindFilter(ids);

    if (ids.size === 0) return [];

    const rows = await db
      .select()
      .from(investigationsTable)
      .where(and(access, inArray(investigationsTable.id, [...ids]), ...filterClauses))
      .orderBy(desc(investigationsTable.createdAt))
      .limit(limit);

    return rows;
  }

  if (timelineKindIds) {
    const rows = await db
      .select()
      .from(investigationsTable)
      .where(and(access, inArray(investigationsTable.id, [...timelineKindIds]), ...filterClauses))
      .orderBy(desc(investigationsTable.createdAt))
      .limit(limit);

    return rows;
  }

  const rows = await db
    .select()
    .from(investigationsTable)
    .where(and(access, ...filterClauses))
    .orderBy(desc(investigationsTable.createdAt))
    .limit(limit);

  return rows;
}

/** Full-text + metadata search across investigation cases (Feature #59). */
export async function searchInvestigations(
  ctx: InvestigationAccessContext,
  query: string,
  limit = 50,
  filters?: Omit<InvestigationListFilters, "query">,
): Promise<InvestigationSearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    const rows = await queryInvestigationRows(ctx, limit, filters);
    return rows.map((row) => toSearchResult(row, undefined, new Map(), new Set()));
  }

  const rows = await queryInvestigationRows(ctx, limit, { ...filters, query: trimmedQuery });
  const { snippets, matchedIds } = await searchTimelineMatches(trimmedQuery, limit);

  return rows.map((row) => toSearchResult(row, trimmedQuery, snippets, matchedIds));
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
