import type { NextFunction, Request, Response } from "express";

import { verifyEvolvexApiKey } from "@repo/services/sdk";

export function requireEvolvexApiKey(req: Request, res: Response, next: NextFunction) {
  const auth = verifyEvolvexApiKey(req.headers.authorization);
  if (!auth.authenticated) {
    return res.status(401).json({
      error: "Invalid or missing API key",
      hint: "Set Authorization: Bearer <EVOLVEX_API_KEY>",
    });
  }

  (req as Request & { sdkAuthMode?: string }).sdkAuthMode = auth.mode;
  return next();
}
