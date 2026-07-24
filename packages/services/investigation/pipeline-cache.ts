import { createHash } from "node:crypto";

import { eq, sql } from "@repo/database";
import { db } from "@repo/database";
import {
  changeEventsTable,
  investigationPipelineCacheTable,
  investigationTimelineEntriesTable,
  investigationsTable,
} from "@repo/database/schema";

/** Bump when pipeline outputs change materially — invalidates prior cache rows. */
export const PIPELINE_CACHE_VERSION = 1;

function readCacheTtlMs() {
  const raw = process.env.INVESTIGATION_CACHE_TTL_MS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 24 * 60 * 60 * 1000;
}

export function getPipelineCacheTtlMs() {
  return readCacheTtlMs();
}

export type PipelineCacheState = "valid" | "miss" | "expired" | "stale" | "none";

export type PipelineCacheStatus = {
  enabled: true;
  pipelineVersion: number;
  ttlMs: number;
  state: PipelineCacheState;
  hit: boolean;
  cachedAt: string | null;
  expiresAt: string | null;
  missReason: string | null;
  missReasonLabel: string;
  contentFingerprint: string | null;
  skipsExpensiveRecompute: boolean;
};

const MISS_REASON_LABELS: Record<string, string> = {
  investigation_not_found: "Investigation not found",
  investigation_not_ready: "Investigation still building",
  no_cache_row: "No cached pipeline run yet",
  cache_expired: "Cache expired — pipeline will recompute on next run",
  pipeline_version_changed: "Pipeline version upgraded — refresh recommended",
  content_changed: "Timeline or evidence changed since last cached run",
};

export type PipelineCacheHit = {
  hit: true;
  cachedAt: Date;
  expiresAt: Date;
  metadata: Record<string, unknown>;
};

export type PipelineCacheMiss = {
  hit: false;
  reason: string;
};

export async function computeInvestigationContentFingerprint(investigationId: string) {
  const [[timeline], [changes], [investigation]] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(investigationTimelineEntriesTable)
      .where(eq(investigationTimelineEntriesTable.investigationId, investigationId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(changeEventsTable)
      .where(eq(changeEventsTable.investigationId, investigationId)),
    db
      .select({
        externalId: investigationsTable.externalId,
        incidentWindowStart: investigationsTable.incidentWindowStart,
        incidentWindowEnd: investigationsTable.incidentWindowEnd,
        updatedAt: investigationsTable.updatedAt,
      })
      .from(investigationsTable)
      .where(eq(investigationsTable.id, investigationId))
      .limit(1),
  ]);

  const row = investigation;
  if (!row) return null;

  const payload = [
    PIPELINE_CACHE_VERSION,
    row.externalId ?? "",
    row.incidentWindowStart?.toISOString() ?? "",
    row.incidentWindowEnd?.toISOString() ?? "",
    timeline?.count ?? 0,
    changes?.count ?? 0,
    row.updatedAt?.toISOString() ?? "",
  ].join("|");

  return createHash("sha256").update(payload).digest("hex").slice(0, 64);
}

export async function getValidPipelineCache(
  investigationId: string,
): Promise<PipelineCacheHit | PipelineCacheMiss> {
  const [investigation] = await db
    .select({
      status: investigationsTable.status,
    })
    .from(investigationsTable)
    .where(eq(investigationsTable.id, investigationId))
    .limit(1);

  if (!investigation) return { hit: false, reason: "investigation_not_found" };
  if (investigation.status !== "ready") return { hit: false, reason: "investigation_not_ready" };

  const [cache] = await db
    .select()
    .from(investigationPipelineCacheTable)
    .where(eq(investigationPipelineCacheTable.investigationId, investigationId))
    .limit(1);

  if (!cache) return { hit: false, reason: "no_cache_row" };

  if (cache.expiresAt.getTime() <= Date.now()) {
    return { hit: false, reason: "cache_expired" };
  }

  if (cache.pipelineVersion !== PIPELINE_CACHE_VERSION) {
    return { hit: false, reason: "pipeline_version_changed" };
  }

  const fingerprint = await computeInvestigationContentFingerprint(investigationId);
  if (!fingerprint || fingerprint !== cache.contentFingerprint) {
    return { hit: false, reason: "content_changed" };
  }

  return {
    hit: true,
    cachedAt: cache.cachedAt,
    expiresAt: cache.expiresAt,
    metadata: cache.metadata ?? {},
  };
}

export async function recordPipelineCache(input: {
  investigationId: string;
  metadata?: Record<string, unknown>;
}) {
  const fingerprint = await computeInvestigationContentFingerprint(input.investigationId);
  if (!fingerprint) return;

  const expiresAt = new Date(Date.now() + readCacheTtlMs());

  await db
    .insert(investigationPipelineCacheTable)
    .values({
      investigationId: input.investigationId,
      pipelineVersion: PIPELINE_CACHE_VERSION,
      contentFingerprint: fingerprint,
      expiresAt,
      metadata: input.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: investigationPipelineCacheTable.investigationId,
      set: {
        pipelineVersion: PIPELINE_CACHE_VERSION,
        contentFingerprint: fingerprint,
        cachedAt: new Date(),
        expiresAt,
        metadata: input.metadata ?? {},
      },
    });
}

export async function invalidatePipelineCache(investigationId: string) {
  await db
    .delete(investigationPipelineCacheTable)
    .where(eq(investigationPipelineCacheTable.investigationId, investigationId));
}

export async function invalidateExpiredPipelineCaches() {
  const result = await db
    .delete(investigationPipelineCacheTable)
    .where(sql`${investigationPipelineCacheTable.expiresAt} <= NOW()`)
    .returning({ id: investigationPipelineCacheTable.investigationId });

  return result.length;
}

export async function getPipelineCacheStatus(investigationId: string): Promise<PipelineCacheStatus> {
  const ttlMs = readCacheTtlMs();
  const valid = await getValidPipelineCache(investigationId);
  const fingerprint = await computeInvestigationContentFingerprint(investigationId);

  const [cache] = await db
    .select()
    .from(investigationPipelineCacheTable)
    .where(eq(investigationPipelineCacheTable.investigationId, investigationId))
    .limit(1);

  if (valid.hit) {
    return {
      enabled: true,
      pipelineVersion: PIPELINE_CACHE_VERSION,
      ttlMs,
      state: "valid",
      hit: true,
      cachedAt: valid.cachedAt.toISOString(),
      expiresAt: valid.expiresAt.toISOString(),
      missReason: null,
      missReasonLabel: "Cache hit — skipping expensive recompute",
      contentFingerprint: fingerprint,
      skipsExpensiveRecompute: true,
    };
  }

  let state: PipelineCacheState = "miss";
  if (valid.reason === "no_cache_row") state = "none";
  else if (valid.reason === "cache_expired") state = "expired";
  else if (valid.reason === "content_changed" || valid.reason === "pipeline_version_changed") {
    state = "stale";
  }

  return {
    enabled: true,
    pipelineVersion: PIPELINE_CACHE_VERSION,
    ttlMs,
    state,
    hit: false,
    cachedAt: cache?.cachedAt?.toISOString() ?? null,
    expiresAt: cache?.expiresAt?.toISOString() ?? null,
    missReason: valid.reason,
    missReasonLabel: MISS_REASON_LABELS[valid.reason] ?? valid.reason,
    contentFingerprint: fingerprint,
    skipsExpensiveRecompute: false,
  };
}
