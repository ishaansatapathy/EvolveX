import { and, desc, eq, ilike, inArray, isNull, or, sql } from "@repo/database";
import { db } from "@repo/database";
import { investigationsTable, type SelectInvestigation } from "@repo/database/schema";

import { shortInvestigationId } from "../signoz/webhook-parser";
import type { InvestigationListItem } from "./types";

function accessFilter(userId: string) {
  return or(eq(investigationsTable.userId, userId), isNull(investigationsTable.userId));
}

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

/** Lists or searches investigation cases with optional metadata filters (Features #59, #60). */
export async function listInvestigations(
  userId: string,
  limit = 50,
  filters?: InvestigationListFilters,
): Promise<InvestigationListItem[]> {
  const trimmedQuery = filters?.query?.trim();
  const filterClauses = applyListFilters(filters);

  if (trimmedQuery) {
    const pattern = `%${escapeLike(trimmedQuery)}%`;

    const metadataMatches = await db
      .select({ id: investigationsTable.id })
      .from(investigationsTable)
      .where(
        and(
          accessFilter(userId),
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
      .where(and(accessFilter(userId), inArray(investigationsTable.id, [...ids]), ...filterClauses))
      .orderBy(desc(investigationsTable.createdAt))
      .limit(limit);

    return rows.map(toListItem);
  }

  const rows = await db
    .select()
    .from(investigationsTable)
    .where(and(accessFilter(userId), ...filterClauses))
    .orderBy(desc(investigationsTable.createdAt))
    .limit(limit);

  return rows.map(toListItem);
}

/** Full-text + metadata search across investigation cases (Feature #59). */
export async function searchInvestigations(
  userId: string,
  query: string,
  limit = 50,
): Promise<InvestigationListItem[]> {
  return listInvestigations(userId, limit, { query });
}

export type SimilarInvestigationMatch = InvestigationListItem & {
  similarityScore: number;
  matchReasons: string[];
};

/** Finds prior cases with overlapping service/alert signals (Feature #17). */
export async function findSimilarInvestigations(
  userId: string,
  investigationId: string,
  limit = 5,
): Promise<SimilarInvestigationMatch[]> {
  const [current] = await db
    .select()
    .from(investigationsTable)
    .where(eq(investigationsTable.id, investigationId))
    .limit(1);

  if (!current) return [];

  const candidates = await db
    .select()
    .from(investigationsTable)
    .where(and(accessFilter(userId), sql`${investigationsTable.id} <> ${investigationId}`))
    .orderBy(desc(investigationsTable.createdAt))
    .limit(100);

  const currentServices = new Set([
    ...(current.affectedServices ?? []),
    ...(current.primaryService ? [current.primaryService] : []),
  ]);

  const scored: SimilarInvestigationMatch[] = [];

  for (const row of candidates) {
    let score = 0;
    const reasons: string[] = [];

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
