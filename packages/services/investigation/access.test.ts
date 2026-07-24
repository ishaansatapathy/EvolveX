import { describe, expect, it } from "vitest";

import { canAccessInvestigation } from "./access";

describe("investigation access", () => {
  it("allows org members to access org-scoped cases", () => {
    const ctx = { userId: "user-a", organizationIds: ["org-1"] };
    expect(
      canAccessInvestigation({ userId: "user-b", organizationId: "org-1" }, ctx),
    ).toBe(true);
  });

  it("falls back to legacy user ownership when organization is unset", () => {
    const ctx = { userId: "user-a", organizationIds: [] };
    expect(canAccessInvestigation({ userId: "user-a", organizationId: null }, ctx)).toBe(true);
    expect(canAccessInvestigation({ userId: "user-b", organizationId: null }, ctx)).toBe(false);
    expect(canAccessInvestigation({ userId: null, organizationId: null }, ctx)).toBe(true);
  });

  it("denies cross-org access for org-scoped rows", () => {
    const ctx = { userId: "user-a", organizationIds: ["org-1"] };
    expect(canAccessInvestigation({ userId: "user-a", organizationId: "org-2" }, ctx)).toBe(false);
  });
});
