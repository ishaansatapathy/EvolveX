import { and, desc, eq, gte, isNull, or } from "@repo/database";
import { db } from "@repo/database";
import { investigationsTable } from "@repo/database/schema";

export const INVESTIGATION_LOOKBACK_MS = 6 * 60 * 60 * 1000;

export async function loadRecentInvestigationCandidates(input: {
  organizationId?: string | null;
  ownerUserId?: string | null;
  since?: Date;
}) {
  const since = input.since ?? new Date(Date.now() - INVESTIGATION_LOOKBACK_MS);

  return db
    .select()
    .from(investigationsTable)
    .where(
      and(
        gte(investigationsTable.createdAt, since),
        input.organizationId
          ? eq(investigationsTable.organizationId, input.organizationId)
          : input.ownerUserId
            ? or(eq(investigationsTable.userId, input.ownerUserId), isNull(investigationsTable.userId))
            : undefined,
      ),
    )
    .orderBy(desc(investigationsTable.createdAt));
}
