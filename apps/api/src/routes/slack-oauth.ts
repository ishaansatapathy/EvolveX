import crypto from "node:crypto";

import { Router } from "express";
import { z } from "zod";
import { logger } from "@repo/logger";
import { verifyAccessToken } from "@repo/services/auth/jwt";
import { isSlackOAuthConfigured } from "@repo/services/env";
import { buildSlackAuthorizeUrl, exchangeSlackOAuthCode } from "@repo/services/integrations/slack-oauth";
import { completeSlackOAuthConnection } from "@repo/services/organization/integrations";
import { env } from "../env";

export const slackOAuthRouter = Router();

const OAUTH_STATE_COOKIE = "evolvex_slack_oauth_state";

function settingsRedirect(status: "connected" | "error", message?: string) {
  const url = new URL("/settings", env.CLIENT_URL);
  url.searchParams.set("slack", status);
  if (message) url.searchParams.set("slack_message", message);
  return url.toString();
}

function currentUserId(req: { cookies?: Record<string, string> }): string | null {
  const accessToken = req.cookies?.jwt;
  if (!accessToken) return null;
  try {
    return verifyAccessToken(accessToken).userId;
  } catch {
    return null;
  }
}

function encodeState(payload: { nonce: string; organizationId: string; returnTo: string }) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeState(state: string | undefined) {
  if (!state) return null;
  try {
    const raw = Buffer.from(state, "base64url").toString("utf8");
    const parsed = z
      .object({ nonce: z.string().uuid(), organizationId: z.string().uuid(), returnTo: z.string().default("/settings") })
      .safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const authorizeQuerySchema = z.object({ organizationId: z.string().uuid() });

/** Starts the "Add to Slack" flow — the Slack equivalent of pasting a SigNoz API key, minus the pasting. */
slackOAuthRouter.get("/slack/authorize", (req, res) => {
  if (!isSlackOAuthConfigured()) {
    return res.redirect(
      settingsRedirect("error", "Slack OAuth is not configured on this deployment (SLACK_CLIENT_ID/SECRET)."),
    );
  }

  const userId = currentUserId(req);
  if (!userId) {
    return res.redirect(`${env.CLIENT_URL}/signin?error=${encodeURIComponent("Sign in first, then connect Slack.")}`);
  }

  const parsed = authorizeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.redirect(settingsRedirect("error", "Missing workspace to connect Slack to."));
  }

  const nonce = crypto.randomUUID();
  const redirectUri = new URL("/integrations/slack/callback", env.BASE_URL).toString();
  const state = encodeState({ nonce, organizationId: parsed.data.organizationId, returnTo: "/settings" });

  res.cookie(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production" || env.NODE_ENV === "prod",
    path: "/",
    maxAge: 10 * 60 * 1000,
  });

  try {
    return res.redirect(buildSlackAuthorizeUrl(state, redirectUri));
  } catch (error) {
    logger.error("Failed to build Slack authorize URL", { message: error instanceof Error ? error.message : error });
    return res.redirect(settingsRedirect("error", "Could not start Slack connect flow."));
  }
});

const callbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});

slackOAuthRouter.get("/slack/callback", async (req, res) => {
  const parsed = callbackQuerySchema.safeParse(req.query);
  const expectedNonce = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;
  res.clearCookie(OAUTH_STATE_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });

  if (!parsed.success) {
    return res.redirect(settingsRedirect("error", "Invalid Slack callback."));
  }

  if (parsed.data.error) {
    const message = parsed.data.error === "access_denied" ? "Slack connection cancelled." : parsed.data.error;
    return res.redirect(settingsRedirect("error", message));
  }

  const { code, state } = parsed.data;
  if (!code) {
    return res.redirect(settingsRedirect("error", "Slack did not return an authorization code."));
  }

  const oauthState = decodeState(state);
  if (!oauthState || !expectedNonce || oauthState.nonce !== expectedNonce) {
    return res.redirect(settingsRedirect("error", "Slack connect session expired — try again."));
  }

  const userId = currentUserId(req);
  if (!userId) {
    return res.redirect(`${env.CLIENT_URL}/signin?error=${encodeURIComponent("Session expired — sign in and retry.")}`);
  }

  try {
    const redirectUri = new URL("/integrations/slack/callback", env.BASE_URL).toString();
    const connection = await exchangeSlackOAuthCode(code, redirectUri);
    await completeSlackOAuthConnection(userId, oauthState.organizationId, connection);
    return res.redirect(settingsRedirect("connected", connection.teamName));
  } catch (error) {
    logger.error("Slack OAuth callback failed", { message: error instanceof Error ? error.message : error });
    const message = error instanceof Error ? error.message : "Slack connection failed.";
    return res.redirect(settingsRedirect("error", message));
  }
});
