import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const resolveOrganizationIdForWebhookSecret = vi.hoisted(() => vi.fn());
const getSignozConfig = vi.hoisted(() => vi.fn());
const checkWebhookSecretRateLimit = vi.hoisted(() => vi.fn());

vi.mock("../organization/integrations", () => ({
  resolveOrganizationIdForWebhookSecret,
}));

vi.mock("../signoz-env", () => ({
  getSignozConfig,
}));

vi.mock("./verify", () => ({
  checkWebhookSecretRateLimit,
}));

import { requireSignozWebhookAuth } from "./signoz-auth";

function mockRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

function basicAuth(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

describe("requireSignozWebhookAuth", () => {
  beforeEach(() => {
    resolveOrganizationIdForWebhookSecret.mockReset();
    getSignozConfig.mockReset();
    checkWebhookSecretRateLimit.mockReset();
    checkWebhookSecretRateLimit.mockResolvedValue(true);
    getSignozConfig.mockReturnValue(null);
  });

  it("resolves the workspace from a per-org Basic-auth password", async () => {
    resolveOrganizationIdForWebhookSecret.mockResolvedValue("org-tenant-a");
    const res = mockRes();

    const result = await requireSignozWebhookAuth(
      { headers: { authorization: basicAuth("evolvex", "whsec_tenant_a") } } as Request,
      res,
    );

    expect(result).toEqual({ ok: true, organizationId: "org-tenant-a" });
    expect(resolveOrganizationIdForWebhookSecret).toHaveBeenCalledWith("signoz", "whsec_tenant_a");
    expect(checkWebhookSecretRateLimit).toHaveBeenCalledWith(res, "signoz", "whsec_tenant_a");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("falls back to the global SIGNOZ_WEBHOOK_SECRET for single-tenant deployments", async () => {
    resolveOrganizationIdForWebhookSecret.mockResolvedValue(null);
    getSignozConfig.mockReturnValue({ webhookSecret: "global-secret", cloudUrl: "https://x", apiKey: "k" });
    const res = mockRes();

    const result = await requireSignozWebhookAuth(
      { headers: { authorization: basicAuth("any", "global-secret") } } as Request,
      res,
    );

    expect(result).toEqual({ ok: true, organizationId: null });
  });

  it("rejects an unknown password when secrets are configured", async () => {
    resolveOrganizationIdForWebhookSecret.mockResolvedValue(null);
    getSignozConfig.mockReturnValue({ webhookSecret: "global-secret", cloudUrl: "https://x", apiKey: "k" });
    const res = mockRes();

    const result = await requireSignozWebhookAuth(
      { headers: { authorization: basicAuth("evolvex", "wrong-password") } } as Request,
      res,
    );

    expect(result).toEqual({ ok: false });
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("requires Basic auth when a global secret is configured but the header is missing", async () => {
    getSignozConfig.mockReturnValue({ webhookSecret: "global-secret", cloudUrl: "https://x", apiKey: "k" });
    const res = mockRes();

    const result = await requireSignozWebhookAuth({ headers: {} } as Request, res);

    expect(result).toEqual({ ok: false });
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("allows unauthenticated requests only when no global secret is configured (dev zero-config)", async () => {
    getSignozConfig.mockReturnValue(null);
    const res = mockRes();

    const result = await requireSignozWebhookAuth({ headers: {} } as Request, res);

    expect(result).toEqual({ ok: true, organizationId: null });
  });

  it("rejects rate-limited per-org secrets", async () => {
    resolveOrganizationIdForWebhookSecret.mockResolvedValue("org-tenant-a");
    checkWebhookSecretRateLimit.mockResolvedValue(false);
    const res = mockRes();

    const result = await requireSignozWebhookAuth(
      { headers: { authorization: basicAuth("evolvex", "whsec_tenant_a") } } as Request,
      res,
    );

    expect(result).toEqual({ ok: false });
  });
});
