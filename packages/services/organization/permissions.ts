import type { OrganizationMemberRole } from "@repo/database/schema";

export type OrganizationPermission =
  | "manage_integrations"
  | "manage_workspace"
  | "mutate_investigations"
  | "view_integrations"
  | "view_audit";

/** Feature #35 — workspace RBAC (owner vs member). Platform admin is separate on users.role. */
export function organizationRoleAllows(
  role: OrganizationMemberRole,
  permission: OrganizationPermission,
): boolean {
  if (role === "owner") return true;

  switch (permission) {
    case "manage_integrations":
    case "manage_workspace":
    case "view_audit":
      return false;
    case "view_integrations":
    case "mutate_investigations":
      return true;
    default:
      return false;
  }
}

export function organizationRoleLabel(role: OrganizationMemberRole) {
  return role === "owner" ? "Owner" : "Member";
}
