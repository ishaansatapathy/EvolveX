import { NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";

import { sanitizeRedirectPath } from "@repo/services/auth/safe-redirect";

function readGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function buildGoogleAuthUrl(state: string, redirectUri: string) {
  const config = readGoogleOAuthConfig();
  if (!config) throw new Error("Google OAuth is not configured");

  const client = new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri,
  });

  return client.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
    state,
  });
}

export async function GET(request: NextRequest) {
  const returnTo = sanitizeRedirectPath(request.nextUrl.searchParams.get("state"));
  const signInUrl = new URL("/signin", request.url);

  if (!readGoogleOAuthConfig()) {
    signInUrl.searchParams.set(
      "error",
      "Google sign-in is not configured yet. Add GOOGLE_OAUTH_* to .env when ready.",
    );
    return NextResponse.redirect(signInUrl);
  }

  try {
    const nonce = crypto.randomUUID();
    const redirectUri = new URL("/api-auth/google/callback", request.url).toString();
    const state = Buffer.from(
      JSON.stringify({ nonce, returnTo, redirectUri }),
      "utf8",
    ).toString("base64url");
    const authUrl = buildGoogleAuthUrl(state, redirectUri);
    const response = NextResponse.redirect(authUrl);
    response.cookies.set("evolvex_oauth_state", nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });
    return response;
  } catch {
    signInUrl.searchParams.set("error", "Google sign-in failed to start. Check OAuth credentials.");
    return NextResponse.redirect(signInUrl);
  }
}
