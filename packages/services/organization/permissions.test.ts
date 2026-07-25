import { describe, expect, it } from "vitest";

import { organizationRoleAllows } from "./permissions";

describe("organization RBAC (#35)", () => {
  it("grants owners full workspace permissions", () => {
    expect(organizationRoleAllows("owner", "manage_integrations")).toBe(true);
    expect(organizationRoleAllows("owner", "manage_workspace")).toBe(true);
    expect(organizationRoleAllows("owner", "view_audit")).toBe(true);
  });

  it("restricts members from integration and workspace management", () => {
    expect(organizationRoleAllows("member", "manage_integrations")).toBe(false);
    expect(organizationRoleAllows("member", "manage_workspace")).toBe(false);
    expect(organizationRoleAllows("member", "view_audit")).toBe(false);
  });

  it("allows members to investigate and view integration status", () => {
    expect(organizationRoleAllows("member", "mutate_investigations")).toBe(true);
    expect(organizationRoleAllows("member", "view_integrations")).toBe(true);
  });
});
