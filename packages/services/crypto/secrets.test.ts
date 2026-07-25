import { describe, expect, it } from "vitest";

import { decryptSecretPayload, encryptSecretPayload, hashWebhookSecret, maskSecret } from "./secrets";

describe("crypto/secrets", () => {
  it("round-trips encrypted payloads", () => {
    process.env.JWT_SECRET = "test-jwt-secret-for-integrations-32chars!!";

    const payload = { apiKey: "sk-signoz-123", webhookSecret: "whsec_abc" };
    const encrypted = encryptSecretPayload(payload);
    const decrypted = decryptSecretPayload(encrypted);

    expect(decrypted).toEqual(payload);
  });

  it("masks secret values for UI display", () => {
    expect(maskSecret("abcdefghijklmnop")).toBe("••••mnop");
    expect(maskSecret(null)).toBeNull();
  });

  it("hashes webhook secrets deterministically and irreversibly", () => {
    const a = hashWebhookSecret("whsec_abc123");
    const b = hashWebhookSecret("whsec_abc123");
    const c = hashWebhookSecret("whsec_different");

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("whsec_abc123");
  });

  it("hashes secrets with surrounding whitespace the same as trimmed", () => {
    expect(hashWebhookSecret("  whsec_abc123  ")).toBe(hashWebhookSecret("whsec_abc123"));
  });
});
