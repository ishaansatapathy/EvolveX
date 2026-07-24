import { index, pgTable, timestamp, uniqueIndex, uuid, varchar, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { usersTable } from "./user";

export const organizationMemberRoleEnum = ["owner", "member"] as const;
export type OrganizationMemberRole = (typeof organizationMemberRoleEnum)[number];

export const organizationsTable = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 128 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => ({
    slugIdx: index("organizations_slug_idx").on(t.slug),
  }),
);

export const organizationMembersTable = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).$type<OrganizationMemberRole>().default("member").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    roleCheck: check(
      "organization_members_role_check",
      sql`${t.role} in ('owner', 'member')`,
    ),
    orgUserUnique: uniqueIndex("organization_members_org_user_idx").on(t.organizationId, t.userId),
    userIdx: index("organization_members_user_idx").on(t.userId),
  }),
);

export type SelectOrganization = typeof organizationsTable.$inferSelect;
export type SelectOrganizationMember = typeof organizationMembersTable.$inferSelect;
