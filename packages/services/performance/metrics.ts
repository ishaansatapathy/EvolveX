import { and, count, desc, eq, gte } from "@repo/database";
import { db } from "@repo/database";
import {
  investigationPipelineCacheTable,
  investigationSummariesTable,
  investigationsTable,
} from "@repo/database/schema";

import { getPipelineCacheTtlMs } from "../investigation/pipeline-cache";

export type PerformanceMetricsSnapshot = {
  generatedAt: string;
  windowDays: number;
  investigations: {
    total: number;
    ready: number;
    building: number;
    failed: number;
    avgBuildMinutes: number | null;
    p95BuildMinutes: number | null;
  };
  cache: {
    enabled: true;
    ttlMs: number;
    rows: number;
    validRows: number;
    hitRateEstimatePercent: number | null;
  };
  summaries: {
    total: number;
    lastGeneratedAt: string | null;
  };
  notes: string[];
};

function percentile(values: number[], pct: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * pct));
  return sorted[index] ?? null;
}

/** Feature #42 — operational metrics for Evolvex itself. */
export async function buildPerformanceMetricsSnapshot(input?: {
  organizationId?: string | null;
  windowDays?: number;
}): Promise<PerformanceMetricsSnapshot> {
  const windowDays = input?.windowDays ?? 30;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const investigationFilters = [gte(investigationsTable.createdAt, since)];
  if (input?.organizationId) {
    investigationFilters.push(eq(investigationsTable.organizationId, input.organizationId));
  }

  const [investigationRows, cacheRows, summaryCountRows, summaryLastRows] = await Promise.all([
    db
      .select({
        status: investigationsTable.status,
        startedAt: investigationsTable.startedAt,
        completedAt: investigationsTable.completedAt,
      })
      .from(investigationsTable)
      .where(and(...investigationFilters)),
    db.select().from(investigationPipelineCacheTable),
    input?.organizationId
      ? db
          .select({ total: count() })
          .from(investigationSummariesTable)
          .innerJoin(
            investigationsTable,
            eq(investigationSummariesTable.investigationId, investigationsTable.id),
          )
          .where(eq(investigationsTable.organizationId, input.organizationId))
      : db.select({ total: count() }).from(investigationSummariesTable),
    db
      .select({ generatedAt: investigationSummariesTable.generatedAt })
      .from(investigationSummariesTable)
      .orderBy(desc(investigationSummariesTable.generatedAt))
      .limit(1),
  ]);

  const byStatus = { ready: 0, building: 0, failed: 0 };
  const buildDurationsMs: number[] = [];
  for (const row of investigationRows) {
    if (row.status === "ready") byStatus.ready += 1;
    else if (row.status === "building") byStatus.building += 1;
    else if (row.status === "failed") byStatus.failed += 1;

    if (row.startedAt && row.completedAt) {
      buildDurationsMs.push(row.completedAt.getTime() - row.startedAt.getTime());
    }
  }

  const avgBuildMs =
    buildDurationsMs.length > 0
      ? buildDurationsMs.reduce((sum, value) => sum + value, 0) / buildDurationsMs.length
      : null;
  const p95BuildMs = percentile(buildDurationsMs, 0.95);

  const now = Date.now();
  const validCacheRows = cacheRows.filter((row) => row.expiresAt.getTime() > now).length;

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    investigations: {
      total: investigationRows.length,
      ready: byStatus.ready,
      building: byStatus.building,
      failed: byStatus.failed,
      avgBuildMinutes: avgBuildMs != null ? Math.round((avgBuildMs / 60_000) * 10) / 10 : null,
      p95BuildMinutes: p95BuildMs != null ? Math.round((p95BuildMs / 60_000) * 10) / 10 : null,
    },
    cache: {
      enabled: true,
      ttlMs: getPipelineCacheTtlMs(),
      rows: cacheRows.length,
      validRows: validCacheRows,
      hitRateEstimatePercent:
        cacheRows.length > 0 ? Math.round((validCacheRows / cacheRows.length) * 100) : null,
    },
    summaries: {
      total: summaryCountRows[0]?.total ?? 0,
      lastGeneratedAt: summaryLastRows[0]?.generatedAt?.toISOString() ?? null,
    },
    notes: [
      "Build duration uses startedAt → completedAt on investigations in the selected window.",
      "Cache hit rate estimates valid cache rows vs total cache rows (proxy until explicit hit counters ship).",
    ],
  };
}
