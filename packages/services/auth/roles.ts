import { z } from "zod";

export const userRoleSchema = z.enum(["user", "admin"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export function isAdminRole(role: UserRole | undefined): boolean {
  return role === "admin";
}
