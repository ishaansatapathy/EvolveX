import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  text,
} from "drizzle-orm/pg-core";
import { check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const authProviderEnum = ["local", "google"] as const;
export type AuthProvider = (typeof authProviderEnum)[number];

export const userRoleEnum = ["user", "admin"] as const;
export type UserRole = (typeof userRoleEnum)[number];

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),

  fullName: varchar("full_name", { length: 80 }).notNull(),
  displayName: varchar("display_name", { length: 80 }),

  email: varchar("email", { length: 255 }).notNull().unique(),
  emailVerified: boolean("email_verified").default(false),

  passwordHash: text("password_hash"),
  authProvider: varchar("auth_provider", { length: 20 }).$type<AuthProvider>().default("local").notNull(),
  providerId: varchar("provider_id", { length: 255 }),

  verificationToken: varchar("verification_token", { length: 64 }),
  verificationTokenExpire: timestamp("verification_token_expire"),
  resetPasswordToken: varchar("reset_password_token", { length: 64 }),
  resetPasswordOtp: varchar("reset_password_otp", { length: 64 }),
  resetPasswordExpire: timestamp("reset_password_expire"),

  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  twoFactorOtp: varchar("two_factor_otp", { length: 64 }),
  twoFactorOtpExpire: timestamp("two_factor_otp_expire"),

  profileImageUrl: text("profile_image_url"),

  role: varchar("role", { length: 20 }).$type<UserRole>().default("user").notNull(),
  tokenVersion: varchar("token_version", { length: 20 }).default("0").notNull(),

  autoApproveEmail: boolean("auto_approve_email").default(false).notNull(),
  autoApproveAgentEmail: boolean("auto_approve_agent_email").default(false).notNull(),
  autoApproveCalendar: boolean("auto_approve_calendar").default(false).notNull(),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
}, (t) => ({
  authProviderCheck: check(
    "users_auth_provider_check",
    sql`${t.authProvider} in ('local', 'google')`,
  ),
  roleCheck: check("users_role_check", sql`${t.role} in ('user', 'admin')`),
}));

export type SelectUser = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
