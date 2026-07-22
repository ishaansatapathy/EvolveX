import { eq, asc } from "@repo/database";
import { db } from "@repo/database";
import { usersTable } from "@repo/database/schema";

let cachedOwnerUserId: string | null | undefined;

export async function resolveInvestigationOwnerUserId(): Promise<string | null> {
  if (cachedOwnerUserId !== undefined) return cachedOwnerUserId;

  const explicitId = process.env.INVESTIGATION_OWNER_USER_ID?.trim();
  if (explicitId) {
    cachedOwnerUserId = explicitId;
    return explicitId;
  }

  const email =
    process.env.INVESTIGATION_OWNER_EMAIL?.trim() ||
    process.env.SEED_USER_EMAIL?.trim() ||
    process.env.DEMO_USER_EMAIL?.trim();

  if (email) {
    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .limit(1);
    cachedOwnerUserId = user?.id ?? null;
    return cachedOwnerUserId;
  }

  const [fallback] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .orderBy(usersTable.createdAt)
    .limit(1);

  cachedOwnerUserId = fallback?.id ?? null;
  return cachedOwnerUserId;
}
