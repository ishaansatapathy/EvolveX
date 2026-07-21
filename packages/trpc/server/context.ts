import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import crypto from "node:crypto";

import { authService } from "./services";

export async function createContext({ req, res }: CreateExpressContextOptions) {
  const headerId = req.headers["x-request-id"];
  const requestId =
    (typeof headerId === "string" && headerId.trim()) || crypto.randomUUID().slice(0, 12);
  res.setHeader("x-request-id", requestId);

  const user = await authService.resolveSession(req, res);
  return { req, res, user, authService, requestId };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
