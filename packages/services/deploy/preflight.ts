export type DeployPreflightIssue = {
  level: "error" | "warning";
  field: string;
  message: string;
};

export type DeployPreflightResult = {
  environment: "development" | "staging" | "production";
  ok: boolean;
  errors: DeployPreflightIssue[];
  warnings: DeployPreflightIssue[];
  summary: string;
};

const PRODUCTION_REQUIRED = [
  "DATABASE_URL",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "BASE_URL",
  "CLIENT_URL",
  "API_INTERNAL_URL",
] as const;

const PRODUCTION_RECOMMENDED = [
  "SIGNOZ_CLOUD_URL",
  "SIGNOZ_API_KEY",
  "SIGNOZ_WEBHOOK_SECRET",
  // Without this, Evolvex's own API never dogfoods OTel — Traces/Logs pages
  // stay empty and there is no self-observability signal to alert on.
  "SIGNOZ_INGESTION_KEY",
  "OPENAI_API_KEY",
  "GITHUB_TOKEN",
] as const;

function readEnv(name: string, env: NodeJS.ProcessEnv) {
  return env[name]?.trim() ?? "";
}

function isHttps(url: string) {
  return url.startsWith("https://");
}

/** Feature #45 — validate env before production/staging deploy. */
export function validateDeployEnvironment(input?: {
  environment?: "development" | "staging" | "production";
  env?: NodeJS.ProcessEnv;
}): DeployPreflightResult {
  const environment = input?.environment ?? (process.env.NODE_ENV === "production" ? "production" : "development");
  const env = input?.env ?? process.env;
  const errors: DeployPreflightIssue[] = [];
  const warnings: DeployPreflightIssue[] = [];

  if (environment === "production") {
    for (const field of PRODUCTION_REQUIRED) {
      if (!readEnv(field, env)) {
        errors.push({ level: "error", field, message: `${field} is required in production` });
      }
    }

    if (readEnv("SKIP_ENV_VALIDATION", env) === "true") {
      errors.push({
        level: "error",
        field: "SKIP_ENV_VALIDATION",
        message: "Must be false in production",
      });
    }

    for (const urlField of ["BASE_URL", "CLIENT_URL", "API_INTERNAL_URL"] as const) {
      const value = readEnv(urlField, env);
      if (value && !isHttps(value)) {
        warnings.push({
          level: "warning",
          field: urlField,
          message: `${urlField} should use HTTPS in production`,
        });
      }
    }

    if (!readEnv("DATABASE_URL_UNPOOLED", env)) {
      warnings.push({
        level: "warning",
        field: "DATABASE_URL_UNPOOLED",
        message: "Set direct Neon URL for reliable migrations during deploy",
      });
    }

    for (const field of PRODUCTION_RECOMMENDED) {
      if (!readEnv(field, env)) {
        warnings.push({
          level: "warning",
          field,
          message: `${field} not set — related integrations will be partial`,
        });
      }
    }
  }

  if (environment === "staging") {
    for (const field of ["DATABASE_URL", "BASE_URL", "CLIENT_URL"] as const) {
      if (!readEnv(field, env)) {
        errors.push({ level: "error", field, message: `${field} is required in staging` });
      }
    }
  }

  const jwtSecret = readEnv("JWT_SECRET", env);
  if (jwtSecret && jwtSecret.length < 32) {
    errors.push({
      level: "error",
      field: "JWT_SECRET",
      message: "JWT_SECRET must be at least 32 characters",
    });
  }

  const ok = errors.length === 0;
  return {
    environment,
    ok,
    errors,
    warnings,
    summary: ok
      ? warnings.length > 0
        ? `Preflight passed with ${warnings.length} warning(s)`
        : "Preflight passed"
      : `Preflight failed with ${errors.length} error(s)`,
  };
}
