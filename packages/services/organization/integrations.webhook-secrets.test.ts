import { describe, expect, it, vi, beforeEach } from "vitest";

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  db: dbMock,
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, op: "eq" })),
  and: vi.fn((...args: unknown[]) => ({ args, op: "and" })),
}));

vi.mock("@repo/database/schema", () => ({
  organizationIntegrationsTable: {
    id: "id",
    organizationId: "organizationId",
    provider: "provider",
    secretHash: "secretHash",
    previousSecretHash: "previousSecretHash",
    previousSecretExpiresAt: "previousSecretExpiresAt",
  },
  organizationMembersTable: {},
}));

import { resolveOrganizationIdForWebhookSecret } from "./integrations";
import { hashWebhookSecret } from "../crypto/secrets";

function mockSelectChain(result: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(result),
      }),
    }),
  };
}

describe("resolveOrganizationIdForWebhookSecret", () => {
  beforeEach(() => {
    dbMock.select.mockReset();
  });

  it("resolves the organization via an indexed current-secret hash match", async () => {
    dbMock.select.mockReturnValueOnce(mockSelectChain([{ organizationId: "org-1" }]));

    const result = await resolveOrganizationIdForWebhookSecret("kubernetes", "my-cluster-secret");

    expect(result).toBe("org-1");
    // Only one query needed when the current hash matches — no fallback scan of every row.
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });

  it("falls back to a still-valid rotated-out secret during the rotation grace window", async () => {
    dbMock.select
      .mockReturnValueOnce(mockSelectChain([])) // no current-secret match
      .mockReturnValueOnce(
        mockSelectChain([{ organizationId: "org-2", previousSecretExpiresAt: new Date(Date.now() + 60_000) }]),
      );

    const result = await resolveOrganizationIdForWebhookSecret("ebpf", "old-secret-mid-rotation");

    expect(result).toBe("org-2");
  });

  it("rejects a previous secret once its grace window has expired", async () => {
    dbMock.select
      .mockReturnValueOnce(mockSelectChain([]))
      .mockReturnValueOnce(
        mockSelectChain([{ organizationId: "org-3", previousSecretExpiresAt: new Date(Date.now() - 60_000) }]),
      );

    const result = await resolveOrganizationIdForWebhookSecret("cicd", "long-expired-secret");

    expect(result).toBeNull();
  });

  it("returns null — never throws — when the secret matches no tenant at all", async () => {
    dbMock.select.mockReturnValueOnce(mockSelectChain([])).mockReturnValueOnce(mockSelectChain([]));

    const result = await resolveOrganizationIdForWebhookSecret("feature_flag", "totally-unknown-secret");

    expect(result).toBeNull();
  });

  it("cannot be tricked by the raw secret value — lookups are always by its hash", async () => {
    const secret = "whsec_super_secret";
    dbMock.select.mockReturnValueOnce(mockSelectChain([{ organizationId: "org-4" }]));

    await resolveOrganizationIdForWebhookSecret("kubernetes", secret);

    const whereCall = dbMock.select.mock.results[0]!.value.from.mock.results[0]!.value.where.mock.calls[0]![0] as {
      args: unknown[];
    };
    // The `and(...)` condition list should reference the hash, not the plaintext secret.
    expect(JSON.stringify(whereCall)).not.toContain(secret);
    expect(JSON.stringify(whereCall)).toContain(hashWebhookSecret(secret));
  });
});
