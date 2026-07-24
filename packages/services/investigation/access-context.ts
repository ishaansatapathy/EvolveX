import { getUserOrganizationIds } from "../organization";

import type { InvestigationAccessContext } from "./access";

/** Loads org membership + user id for investigation authorization checks. */
export async function loadInvestigationAccessContext(userId: string): Promise<InvestigationAccessContext> {
  const organizationIds = await getUserOrganizationIds(userId);
  return { userId, organizationIds };
}
