import { logger } from "@repo/logger";
import { isEmailConfigured } from "@repo/services/env";
import { isSignozConfigured } from "@repo/services/signoz-env";

import { runMigrations } from "./migrate";

export type ApiBootstrapOptions = {
  serverless?: boolean;
};

export async function runApiBootstrap(_opts: ApiBootstrapOptions = {}): Promise<void> {
  try {
    await runMigrations();
    logger.info("Database schema patches applied");
  } catch (err) {
    logger.error("Database migration failed", { err });
  }

  logger.info(
    isEmailConfigured()
      ? "Email: provider configured"
      : "Email: not configured (set BREVO_API_KEY + EMAIL_FROM for verification emails)",
  );

  logger.info(
    isSignozConfigured()
      ? "SigNoz: Cloud API configured"
      : "SigNoz: not configured (set SIGNOZ_CLOUD_URL + SIGNOZ_API_KEY for trace enrichment)",
  );
}

export function validateApiEnv(): string[] {
  return ["DATABASE_URL", "JWT_SECRET", "BASE_URL", "CLIENT_URL"].filter(
    (key) => !process.env[key]?.trim(),
  );
}
