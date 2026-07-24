import { and, eq, inArray, isNull, or, type SQL } from "@repo/database";
import { investigationsTable } from "@repo/database/schema";

import type { InvestigationAccessContext } from "./access";

/** Drizzle WHERE clause limiting investigations to accessible rows. */
export function buildInvestigationAccessFilter(ctx: InvestigationAccessContext): SQL {
  const legacyAccess = or(eq(investigationsTable.userId, ctx.userId), isNull(investigationsTable.userId));

  if (ctx.organizationIds.length === 0) {
    return and(isNull(investigationsTable.organizationId), legacyAccess)!;
  }

  return or(
    inArray(investigationsTable.organizationId, ctx.organizationIds),
    and(isNull(investigationsTable.organizationId), legacyAccess),
  )!;
}
