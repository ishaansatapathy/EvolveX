import { isNull } from "@repo/database";
import { db } from "@repo/database";
import { investigationsTable } from "@repo/database/schema";
import { resolveInvestigationOwnerUserId } from "@repo/services/investigation/owner";
import { ensureUserOrganization, resolveOrganizationForUser } from "@repo/services/organization";

async function main() {
  const ownerUserId = await resolveInvestigationOwnerUserId();
  if (!ownerUserId) {
    console.error("[org:backfill] No investigation owner user found.");
    process.exit(1);
  }

  const organizationId = await resolveOrganizationForUser(ownerUserId);
  if (!organizationId) {
    console.error("[org:backfill] Failed to resolve organization.");
    process.exit(1);
  }

  await ensureUserOrganization(ownerUserId);

  const unscoped = await db
    .select({ id: investigationsTable.id })
    .from(investigationsTable)
    .where(isNull(investigationsTable.organizationId));

  if (unscoped.length === 0) {
    console.log("[org:backfill] All investigations already scoped to an organization.");
    return;
  }

  await db
    .update(investigationsTable)
    .set({ organizationId })
    .where(isNull(investigationsTable.organizationId));

  console.log(`[org:backfill] Assigned ${unscoped.length} investigation(s) to organization ${organizationId}.`);
}

main().catch((error) => {
  console.error("[org:backfill] Failed:", error);
  process.exit(1);
});
