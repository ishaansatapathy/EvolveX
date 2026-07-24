import { desc, eq } from "@repo/database";
import { db } from "@repo/database";
import { auditEventsTable } from "@repo/database/schema";
import { logger } from "@repo/logger";

export type AuditEventDto = {
  id: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export async function recordAuditEvent(input: {
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(auditEventsTable).values({
      actorUserId: input.actorUserId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (error) {
    logger.warn("Failed to record audit event", {
      action: input.action,
      resourceType: input.resourceType,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function listAuditEvents(input: {
  limit?: number;
  investigationId?: string;
}): Promise<AuditEventDto[]> {
  const limit = Math.min(input.limit ?? 50, 200);

  const rows = input.investigationId
    ? await db
        .select()
        .from(auditEventsTable)
        .where(eq(auditEventsTable.resourceId, input.investigationId))
        .orderBy(desc(auditEventsTable.createdAt))
        .limit(limit)
    : await db.select().from(auditEventsTable).orderBy(desc(auditEventsTable.createdAt)).limit(limit);

  return rows.map((row) => ({
    id: row.id,
    actorUserId: row.actorUserId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt.toISOString(),
  }));
}
