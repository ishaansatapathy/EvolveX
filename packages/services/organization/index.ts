import { eq } from "@repo/database";
import { db } from "@repo/database";
import {
  organizationMembersTable,
  organizationsTable,
  usersTable,
} from "@repo/database/schema";

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "member";
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Returns organization ids the user belongs to. */
export async function getUserOrganizationIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ organizationId: organizationMembersTable.organizationId })
    .from(organizationMembersTable)
    .where(eq(organizationMembersTable.userId, userId));

  return rows.map((row) => row.organizationId);
}

/** Ensures every user has a workspace organization (auto-provision on first access). */
export async function ensureUserOrganization(userId: string): Promise<OrganizationSummary> {
  const [existing] = await db
    .select({
      id: organizationsTable.id,
      name: organizationsTable.name,
      slug: organizationsTable.slug,
      role: organizationMembersTable.role,
    })
    .from(organizationMembersTable)
    .innerJoin(organizationsTable, eq(organizationMembersTable.organizationId, organizationsTable.id))
    .where(eq(organizationMembersTable.userId, userId))
    .limit(1);

  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      slug: existing.slug,
      role: existing.role,
    };
  }

  const [user] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const baseName = user?.fullName?.trim() || "Workspace";
  const name = `${baseName}'s workspace`;
  const slug = `${slugify(baseName || "workspace")}-${userId.slice(0, 8)}`;

  const [organization] = await db
    .insert(organizationsTable)
    .values({ name, slug })
    .returning();

  if (!organization) {
    throw new Error("Failed to create organization");
  }

  await db.insert(organizationMembersTable).values({
    organizationId: organization.id,
    userId,
    role: "owner",
  });

  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    role: "owner",
  };
}

/** Resolves the organization used for webhook-created investigations. */
export async function resolveOrganizationForUser(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const organization = await ensureUserOrganization(userId);
  return organization.id;
}

export async function listUserOrganizations(userId: string): Promise<OrganizationSummary[]> {
  await ensureUserOrganization(userId);

  const rows = await db
    .select({
      id: organizationsTable.id,
      name: organizationsTable.name,
      slug: organizationsTable.slug,
      role: organizationMembersTable.role,
    })
    .from(organizationMembersTable)
    .innerJoin(organizationsTable, eq(organizationMembersTable.organizationId, organizationsTable.id))
    .where(eq(organizationMembersTable.userId, userId));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    role: row.role,
  }));
}
