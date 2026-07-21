import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/** Google Calendar push channel ids per user — used to stop channels before renewal. */
export const threadCalendarStateTable = pgTable("thread_calendar_state", {
  userId: varchar("user_id", { length: 64 }).primaryKey(),
  channelId: varchar("channel_id", { length: 256 }).notNull(),
  resourceId: varchar("resource_id", { length: 256 }),
  expiration: timestamp("expiration"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SelectCalendarState = typeof threadCalendarStateTable.$inferSelect;
export type InsertCalendarState = typeof threadCalendarStateTable.$inferInsert;
