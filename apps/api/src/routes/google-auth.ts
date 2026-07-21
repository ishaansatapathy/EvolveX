import { Router } from "express";
import { z } from "zod";
import { logger } from "@repo/logger";
import AuthService from "@repo/services/auth";
import { toAuthError } from "@repo/services/auth/errors";
import { sanitizeRedirectPath } from "@repo/services/auth/safe-redirect";
import { env } from "../env";

const authService = new AuthService();

export const googleAuthRouter = Router();

const googleCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

function isAllowedGoogleOAuthRedirectUri(redirectUri: string) {
  try {
    const url = new URL(redirectUri);
    if (url.pathname !== "/api-auth/google/callback") return false;
    const clientOrigin = new URL(env.CLIENT_URL).origin;
    if (url.origin === clientOrigin) return true;
    if (url.hostname === "localhost" && url.protocol === "http:") return true;
    const configured = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
    if (configured && url.origin === new URL(configured).origin) return true;
    return false;
  } catch {
    return false;
  }
}

function decodeOAuthState(state: string | undefined) {
  if (!state) return null;
  try {
    const raw = Buffer.from(state, "base64url").toString("utf8");
    const parsed = z
      .object({
        nonce: z.string().uuid(),
        returnTo: z.string().default("/dashboard"),
        redirectUri: z.string().url().optional(),
      })
      .safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const redirectUri = parsed.data.redirectUri?.trim();
    return {
      nonce: parsed.data.nonce,
      returnTo: sanitizeRedirectPath(parsed.data.returnTo),
      redirectUri:
        redirectUri && isAllowedGoogleOAuthRedirectUri(redirectUri) ? redirectUri : undefined,
    };
  } catch {
    return null;
  }
}

function signinErrorRedirect(message: string) {
  return `${env.CLIENT_URL}/signin?error=${encodeURIComponent(message)}`;
}

googleAuthRouter.get("/google/callback", async (req, res) => {
  const parsed = googleCallbackQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.redirect(signinErrorRedirect("Invalid Google sign-in callback."));
  }

  const { code, state, error: oauthError, error_description: errorDescription } = parsed.data;

  if (oauthError) {
    const message =
      errorDescription?.trim() ||
      (oauthError === "redirect_uri_mismatch"
        ? "Google sign-in redirect URI mismatch. Clear cookies and try again from the sign-in page."
        : oauthError.replace(/_/g, " "));
    return res.redirect(signinErrorRedirect(message));
  }

  if (!code) {
    return res.redirect(
      signinErrorRedirect("Start sign-in from the sign-in page — do not open the callback URL directly."),
    );
  }

  const oauthState = decodeOAuthState(state);
  const expectedNonce = req.cookies?.evolvex_oauth_state as string | undefined;
  res.clearCookie("evolvex_oauth_state", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production" || env.NODE_ENV === "prod",
    path: "/",
  });

  if (!oauthState || !expectedNonce || oauthState.nonce !== expectedNonce) {
    return res.redirect(signinErrorRedirect("Google sign-in session expired. Please try again."));
  }

  try {
    const redirectUrl = await authService.handleGoogleCallback(
      code,
      res,
      oauthState.returnTo,
      oauthState.redirectUri,
    );
    return res.redirect(redirectUrl);
  } catch (error) {
    const authError = toAuthError(error, "Google sign-in failed. Please try again.");

    logger.error("Google OAuth callback failed", {
      message: authError.message,
      stack: authError.stack,
    });

    return res.redirect(signinErrorRedirect(authError.message));
  }
});
