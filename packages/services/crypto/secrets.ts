import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_SALT = "evolvex-org-integrations-v1";

function getEncryptionKey(): Buffer {
  const raw = process.env.INTEGRATION_SECRETS_KEY?.trim() || process.env.JWT_SECRET?.trim();
  if (!raw) {
    throw new Error("INTEGRATION_SECRETS_KEY or JWT_SECRET is required to store integration secrets");
  }

  return scryptSync(raw, KEY_SALT, 32);
}

/** Encrypts a JSON-serializable secrets payload for at-rest storage. */
export function encryptSecretPayload(payload: Record<string, unknown>): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/** Decrypts an encrypted secrets payload. */
export function decryptSecretPayload(ciphertext: string): Record<string, unknown> {
  const key = getEncryptionKey();
  const buffer = Buffer.from(ciphertext, "base64");
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as Record<string, unknown>;
}

export function maskSecret(value: string | undefined | null, visible = 4): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.length <= visible) return "••••";
  return `••••${trimmed.slice(-visible)}`;
}
