const APP_DEFAULT_REDIRECT = "/inbox";
const SAFE_FALLBACK = "/";

/**
 * Allow only same-origin relative paths. Blocks open redirects like `//evil.com`.
 * Invalid or malicious input always returns `/` — never an attacker-controlled URL.
 */
export function sanitizeRedirectPath(
  path: string | null | undefined,
  fallback = APP_DEFAULT_REDIRECT,
): string {
  if (!path || typeof path !== "string") return fallback;

  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return SAFE_FALLBACK;
  if (trimmed.includes("\\") || trimmed.includes("@") || trimmed.includes(":")) {
    return SAFE_FALLBACK;
  }

  return trimmed;
}
