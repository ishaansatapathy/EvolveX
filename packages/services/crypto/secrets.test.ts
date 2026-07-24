import { describe, expect, it } from "vitest";

import { decryptSecretPayload, encryptSecretPayload, maskSecret } from "./secrets";

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
});
