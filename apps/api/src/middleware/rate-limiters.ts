import type { Request, Response, NextFunction } from "express";

import { checkDistributedRateLimit } from "@repo/services/cache/rate-limit";
import { authService } from "@repo/trpc/server/services";

const skipInTests = () => process.env.VITEST === "true";

type LimitConfig = {
  windowMs: number;
  max: number;
  message: string;
  keyGenerator?: (req: Request) => string;
};

async function applyRateLimit(req: Request, res: Response, config: LimitConfig): Promise<boolean> {
  if (skipInTests()) return true;

  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const key = config.keyGenerator ? config.keyGenerator(req) : ip;
  const result = await checkDistributedRateLimit(key, config.max, config.windowMs);

  res.setHeader("RateLimit-Limit", String(config.max));
  res.setHeader("RateLimit-Remaining", String(result.remaining));

  if (!result.allowed) {
    res.status(429).json({ message: config.message });
    return false;
  }

  return true;
}

/**
 * Match a tRPC path string (e.g. "auth.signIn") against a set of expected
 * procedure identifiers using exact segment comparison, not substring search.
 */
export function matchesProcedure(path: string, procedures: string[]): boolean {
  const pathTokens = path.split(".");
  return procedures.some((proc) => {
    const procTokens = proc.split(".");
    if (pathTokens.length !== procTokens.length) return false;
    return pathTokens.every((token, i) => token === procTokens[i]);
  });
}

const AUTH_CREDENTIAL_PROCS = ["auth.signUp", "auth.signIn", "auth.verify2FA", "auth.refresh"];
const PASSWORD_RESET_PROCS = ["auth.forgotPassword", "auth.verifyOtp", "auth.resetPassword"];
/** Agent chat is expensive (OpenAI calls) and a vector for mass-send abuse. */
const AGENT_CHAT_PROCS = ["agent.chat"];

export function normalizeProcedurePath(path: string) {
  const normalized = path.replace(/^\/+/, "");
  const restProcedureMap: Record<string, string> = {
    "authentication/sign-up": "auth.signUp",
    "authentication/sign-in": "auth.signIn",
    "authentication/verify-2fa": "auth.verify2FA",
    "authentication/refresh": "auth.refresh",
    "authentication/forgot-password": "auth.forgotPassword",
    "authentication/verify-otp": "auth.verifyOtp",
    "authentication/reset-password": "auth.resetPassword",
  };

  return restProcedureMap[normalized] ?? normalized;
}

export function createTrpcRateLimitMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const path = normalizeProcedurePath(req.path);

    if (matchesProcedure(path, AUTH_CREDENTIAL_PROCS)) {
      const ok = await applyRateLimit(req, res, {
        windowMs: 15 * 60 * 1000,
        max: 40,
        message: "Too many login or signup attempts. Try again later.",
      });
      return ok ? next() : undefined;
    }

    if (matchesProcedure(path, PASSWORD_RESET_PROCS)) {
      const ok = await applyRateLimit(req, res, {
        windowMs: 15 * 60 * 1000,
        max: 30,
        message: "Too many password reset attempts. Try again in 15 minutes.",
      });
      return ok ? next() : undefined;
    }

    if (matchesProcedure(path, AGENT_CHAT_PROCS)) {
      const user = await authService.resolveSession(req, res);
      const ok = await applyRateLimit(req, res, {
        windowMs: 60 * 1000, // 1 minute
        max: 20, // 20 agent calls per user per minute
        message: "Too many agent requests. Please wait a moment before sending another message.",
        keyGenerator: (r) => {
          if (user?.id) return `agent:${user.id}`;
          return `agent:ip:${r.ip ?? r.socket.remoteAddress ?? "unknown"}`;
        },
      });
      return ok ? next() : undefined;
    }

    return next();
  };
}
