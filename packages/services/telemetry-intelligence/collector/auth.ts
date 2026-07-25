import { timingSafeEqual } from "node:crypto";

import { extractBearerToken } from "../../sdk/auth";

export type CollectorAuthContext = {
  authenticated: boolean;
  mode: "collector_key" | "development";
};

/** Feature #31 — Bearer auth for collector config pull endpoints. */
export function verifyCollectorApiKey(authHeader: string | undefined): CollectorAuthContext {
  const expected =
    process.env.EVOLVEX_COLLECTOR_KEY?.trim() || process.env.EVOLVEX_API_KEY?.trim();
  const isProd = process.env.NODE_ENV === "production";

  if (!expected) {
    if (isProd) {
      return { authenticated: false, mode: "collector_key" };
    }
    return { authenticated: true, mode: "development" };
  }

  const token = extractBearerToken(authHeader);
  if (!token) {
    return { authenticated: false, mode: "collector_key" };
  }

  try {
    const ok = timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    return { authenticated: ok, mode: "collector_key" };
  } catch {
    return { authenticated: false, mode: "collector_key" };
  }
}

export function isCollectorAuthConfigured() {
  return (
    Boolean(process.env.EVOLVEX_COLLECTOR_KEY?.trim()) ||
    Boolean(process.env.EVOLVEX_API_KEY?.trim()) ||
    process.env.NODE_ENV !== "production"
  );
}
