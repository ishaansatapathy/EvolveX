import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type SdkAuthContext = {
  authenticated: boolean;
  mode: "api_key" | "development";
};

/** Feature #57 — Bearer API key auth for external SDK clients. */
export function verifyEvolvexApiKey(authHeader: string | undefined): SdkAuthContext {
  const expected = process.env.EVOLVEX_API_KEY?.trim();
  const isProd = process.env.NODE_ENV === "production";

  if (!expected) {
    if (isProd) {
      return { authenticated: false, mode: "api_key" };
    }
    return { authenticated: true, mode: "development" };
  }

  const token = extractBearerToken(authHeader);
  if (!token) {
    return { authenticated: false, mode: "api_key" };
  }

  try {
    const ok = timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    return { authenticated: ok, mode: "api_key" };
  } catch {
    return { authenticated: false, mode: "api_key" };
  }
}

export function extractBearerToken(authHeader: string | undefined) {
  if (!authHeader?.trim()) return null;
  if (authHeader.startsWith("Bearer ")) return authHeader.slice("Bearer ".length).trim();
  return authHeader.trim();
}

export function generateEvolvexApiKey() {
  return `evx_${randomBytes(24).toString("hex")}`;
}

export function hashApiKeyPreview(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 12);
}

export function isSdkConfigured() {
  return Boolean(process.env.EVOLVEX_API_KEY?.trim()) || process.env.NODE_ENV !== "production";
}
