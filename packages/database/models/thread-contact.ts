import { index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

import { usersTable } from "./user";

export const contactSourceEnum = ["manual", "inbox", "sent", "agent"] as const;
export type ContactSource = (typeof contactSourceEnum)[number];

export const threadContactsTable = pgTable(
  "thread_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    displayName: varchar("display_name", { length: 120 }),
    /** Lowercase prefix used for @mention autocomplete (e.g. debaditya). */
    handle: varchar("handle", { length: 80 }).notNull(),
    source: varchar("source", { length: 20 }).$type<ContactSource>().notNull().default("manual"),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    userEmailUnique: uniqueIndex("thread_contacts_user_email_unique").on(table.userId, table.email),
    userHandleIdx: index("thread_contacts_user_handle_idx").on(table.userId, table.handle),
    userLastUsedIdx: index("thread_contacts_user_last_used_idx").on(table.userId, table.lastUsedAt),
  }),
);

export type SelectThreadContact = typeof threadContactsTable.$inferSelect;
export type InsertThreadContact = typeof threadContactsTable.$inferInsert;
