import { Router } from "express";

import AuthService from "@repo/services/auth";
import { toAuthError } from "@repo/services/auth/errors";

import { env } from "../env";

const authService = new AuthService();

export const devAuthRouter = Router();

devAuthRouter.get("/quick-login", async (_req, res) => {
  if (env.NODE_ENV !== "development") {
    return res.status(404).json({ error: "Not found" });
  }

  const ownerEmail = process.env.INVESTIGATION_OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) {
    return res.redirect(
      `${env.CLIENT_URL}/signin?error=${encodeURIComponent("Set INVESTIGATION_OWNER_EMAIL in .env")}`,
    );
  }

  try {
    const redirectUrl = await authService.issueDevSession(res, ownerEmail, "/investigations");
    return res.redirect(redirectUrl);
  } catch (error) {
    const authError = toAuthError(error, "Dev quick-login failed.");
    return res.redirect(`${env.CLIENT_URL}/signin?error=${encodeURIComponent(authError.message)}`);
  }
});
