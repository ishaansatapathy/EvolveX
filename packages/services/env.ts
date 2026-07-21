import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

function loadRootEnv() {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const envPath = path.join(dir, ".env");
    if (fs.existsSync(envPath)) {
      // In dev/watch mode, the process can restart without a full env reset.
      // Override ensures the repo root .env stays the source of truth.
      config({ path: envPath, override: true });
      return;
    }
    dir = path.dirname(dir);
  }
}

loadRootEnv();

const envSchema = z.object({
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16).optional(),
  CLIENT_URL: z.string().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "production", "prod", "test"]).default("development"),
  JWT_COOKIE_SAMESITE: z.string().optional(),
  JWT_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),
  /** Brevo (recommended) ? transactional email to any recipient */
  BREVO_API_KEY: z.string().optional(),
  /** e.g. Thread <noreply@yourdomain.com> — sender must be verified in Brevo */
  EMAIL_FROM: z.string().optional(),
  EMAIL_SENDER_NAME: z.string().optional(),
  EMAIL_PROVIDER: z.literal("brevo").optional(),
  /** Cloudflare Turnstile secret — bot protection on sign-up / sign-in */
  TURNSTILE_SECRET_KEY: z.string().optional(),
});

function createEnv(env: NodeJS.ProcessEnv) {
  const safeParseResult = envSchema.safeParse(env);
  if (!safeParseResult.success) throw new Error(safeParseResult.error.message);
  return safeParseResult.data;
}

export const env = createEnv(process.env);

function googleOAuthFromProcess() {
  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID?.trim(),
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim(),
  };
}

export function getGoogleOAuthConfig() {
  const fromProcess = googleOAuthFromProcess();
  return {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID?.trim() || fromProcess.clientId,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || fromProcess.clientSecret,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || fromProcess.redirectUri,
  };
}

export function isGoogleOAuthConfigured() {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
  return !!(clientId && clientSecret && redirectUri);
}

export function isEmailConfigured() {
  const from = env.EMAIL_FROM?.trim();
  const apiKey = env.BREVO_API_KEY?.trim();
  return Boolean(from && apiKey);
}
