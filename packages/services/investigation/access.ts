import type { SelectInvestigation } from "@repo/database/schema";

export type InvestigationAccessContext = {
  userId: string;
  organizationIds: string[];
};

type InvestigationAccessRow = Pick<SelectInvestigation, "userId" | "organizationId">;

/** True when the user may read or mutate an investigation row. */
export function canAccessInvestigation(row: InvestigationAccessRow, ctx: InvestigationAccessContext): boolean {
  if (row.organizationId && ctx.organizationIds.includes(row.organizationId)) {
    return true;
  }

  // Legacy rows created before org scoping was enabled.
  if (!row.organizationId) {
    return !row.userId || row.userId === ctx.userId;
  }

  return false;
}
