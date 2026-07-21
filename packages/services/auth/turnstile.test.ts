import type { Request } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { assertTurnstileToken, getClientIp, verifyTurnstileToken } from "./turnstile";

describe("turnstile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it("getClientIp prefers x-forwarded-for", () => {
    const req = {
      headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;

    expect(getClientIp(req)).toBe("203.0.113.1");
  });

  it("verifyTurnstileToken skips when secret is unset", async () => {
    await expect(verifyTurnstileToken("any-token")).resolves.toBe(true);
  });

  it("assertTurnstileToken requires a token when secret is set", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key";

    await expect(assertTurnstileToken(undefined)).rejects.toMatchObject({
      message: expect.stringContaining("Security verification required"),
    });
  });

  it("verifyTurnstileToken calls Cloudflare siteverify", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyTurnstileToken("cf-token", "127.0.0.1")).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ method: "POST" }),
    );

    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("secret")).toBe("test-secret-key");
    expect(body.get("response")).toBe("cf-token");
    expect(body.get("remoteip")).toBe("127.0.0.1");
  });
});
