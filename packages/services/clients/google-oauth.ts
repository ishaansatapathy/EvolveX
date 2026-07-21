import { OAuth2Client } from "google-auth-library";

import { getGoogleOAuthConfig, isGoogleOAuthConfigured } from "../env";

let googleOAuth2Client: OAuth2Client | null = null;

export function getGoogleOAuth2Client(): OAuth2Client {
  if (!isGoogleOAuthConfigured()) {
    throw new Error("Google OAuth is not configured");
  }

  if (!googleOAuth2Client) {
    const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
    googleOAuth2Client = new OAuth2Client({
      clientId,
      clientSecret,
      redirectUri,
    });
  }

  return googleOAuth2Client;
}

export function generateGoogleAuthUrl(state?: string) {
  const client = getGoogleOAuth2Client();
  return client.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
    state,
  });
}

export { isGoogleOAuthConfigured };
