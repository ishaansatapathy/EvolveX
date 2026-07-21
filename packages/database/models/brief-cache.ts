import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { usersTable } from "./user";

export const briefCacheTable = pgTable(
  "brief_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD in the user's local timezone */
    dateKey: text("date_key").notNull(),
    /** Serialized DailyBrief JSON */
    briefJson: text("brief_json").notNull(),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
  },
  (t) => ({
    userDateIdx: uniqueIndex("brief_cache_user_date_idx").on(t.userId, t.dateKey),
  }),
);

export type SelectBriefCache = typeof briefCacheTable.$inferSelect;
export type InsertBriefCache = typeof briefCacheTable.$inferInsert;
