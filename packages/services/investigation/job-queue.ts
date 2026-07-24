import { and, eq, inArray, sql } from "@repo/database";
import { db } from "@repo/database";
import { investigationJobsTable, investigationsTable } from "@repo/database/schema";

export type ClaimedInvestigationJob = {
  jobId: string;
  investigationId: string;
  attempts: number;
};

/** Enqueues a durable pipeline job — skips if one is already pending/running. */
export async function enqueueInvestigationPipelineJob(investigationId: string): Promise<boolean> {
  const existing = await db
    .select({ id: investigationJobsTable.id })
    .from(investigationJobsTable)
    .where(
      and(
        eq(investigationJobsTable.investigationId, investigationId),
        eq(investigationJobsTable.kind, "pipeline"),
        inArray(investigationJobsTable.status, ["pending", "running"]),
      ),
    )
    .limit(1);

  if (existing.length > 0) return false;

  await db.insert(investigationJobsTable).values({
    investigationId,
    kind: "pipeline",
    status: "pending",
  });

  return true;
}

/** Claims the next pending job using Postgres row locking (production-safe worker). */
export async function claimNextInvestigationJob(): Promise<ClaimedInvestigationJob | null> {
  const result = await db.execute<{ id: string; investigation_id: string; attempts: number }>(sql`
    UPDATE investigation_jobs
    SET
      status = 'running',
      started_at = NOW(),
      attempts = attempts + 1,
      updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM investigation_jobs
      WHERE status = 'pending'
        AND scheduled_at <= NOW()
        AND attempts < max_attempts
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, investigation_id, attempts
  `);

  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: { id: string; investigation_id: string; attempts: number }[] }).rows ?? []);

  const row = rows[0];
  if (!row) return null;

  return {
    jobId: row.id,
    investigationId: row.investigation_id,
    attempts: row.attempts,
  };
}

export async function completeInvestigationJob(jobId: string): Promise<void> {
  await db
    .update(investigationJobsTable)
    .set({
      status: "completed",
      completedAt: new Date(),
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(investigationJobsTable.id, jobId));
}

export async function failInvestigationJob(
  jobId: string,
  investigationId: string,
  errorMessage: string,
  attempts: number,
  maxAttempts = 3,
): Promise<void> {
  const shouldRetry = attempts < maxAttempts;

  await db
    .update(investigationJobsTable)
    .set({
      status: shouldRetry ? "pending" : "failed",
      errorMessage,
      scheduledAt: shouldRetry ? new Date(Date.now() + attempts * 30_000) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(investigationJobsTable.id, jobId));

  if (!shouldRetry) {
    await db
      .update(investigationsTable)
      .set({
        status: "failed",
        errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(investigationsTable.id, investigationId));
  }
}

/** Requeues jobs stuck in running state (e.g. after API crash). */
export async function recoverStaleInvestigationJobs(staleAfterMs = 15 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);

  const result = await db
    .update(investigationJobsTable)
    .set({
      status: "pending",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(investigationJobsTable.status, "running"),
        sql`${investigationJobsTable.startedAt} < ${cutoff}`,
      ),
    )
    .returning({ id: investigationJobsTable.id });

  return result.length;
}

export async function countPendingInvestigationJobs(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(investigationJobsTable)
    .where(eq(investigationJobsTable.status, "pending"));

  return row?.count ?? 0;
}
