import type { Request } from "express";

import { AuthError } from "./errors";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function turnstileSecretKey() {
  return process.env.TURNSTILE_SECRET_KEY?.trim();
}

export function isTurnstileConfigured() {
  return Boolean(turnstileSecretKey());
}

export function getClientIp(req: Request): string | undefined {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(",")[0]?.trim();
  }
  const ip = req.socket?.remoteAddress;
  return ip && ip.length > 0 ? ip : undefined;
}

export async function verifyTurnstileToken(token: string, remoteip?: string): Promise<boolean> {
  const secret = turnstileSecretKey();
  if (!secret) return true;

  const body = new URLSearchParams({
    secret,
    response: token,
  });
  if (remoteip) body.set("remoteip", remoteip);

  const response = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) return false;

  const payload = (await response.json()) as { success?: boolean };
  return payload.success === true;
}

export async function assertTurnstileToken(token: string | undefined, remoteip?: string): Promise<void> {
  if (!isTurnstileConfigured()) return;

  const trimmed = token?.trim();
  if (!trimmed) {
    throw new AuthError(
      "BAD_REQUEST",
      "Security verification required. Complete the check and try again.",
    );
  }

  const valid = await verifyTurnstileToken(trimmed, remoteip);
  if (!valid) {
    throw new AuthError("BAD_REQUEST", "Security verification failed. Please try again.");
  }
}
