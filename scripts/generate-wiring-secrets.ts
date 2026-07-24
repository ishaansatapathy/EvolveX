import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

function upsertEnvKey(contents: string, key: string, value: string) {
  const line = `${key}=${value}`;
  const activePattern = new RegExp(`^${key}=.*$`, "m");
  const commentedPattern = new RegExp(`^#\\s*${key}=.*$`, "m");

  if (activePattern.test(contents)) {
    return contents.replace(activePattern, line);
  }
  if (commentedPattern.test(contents)) {
    return contents.replace(commentedPattern, line);
  }
  return `${contents.trimEnd()}\n${line}\n`;
}

function hasActiveSecret(contents: string, key: string) {
  const match = contents.match(new RegExp(`^${key}=(.*)$`, "m"));
  return Boolean(match?.[1]?.trim());
}

const signozSecret = randomBytes(24).toString("hex");
const githubSecret = randomBytes(24).toString("hex");

let env = readFileSync(envPath, "utf8");

if (hasActiveSecret(env, "SIGNOZ_WEBHOOK_SECRET")) {
  console.log("[wiring:secrets] SIGNOZ_WEBHOOK_SECRET already set — skipped");
} else {
  env = upsertEnvKey(env, "SIGNOZ_WEBHOOK_SECRET", signozSecret);
  console.log("[wiring:secrets] Set SIGNOZ_WEBHOOK_SECRET");
}

if (hasActiveSecret(env, "GITHUB_WEBHOOK_SECRET")) {
  console.log("[wiring:secrets] GITHUB_WEBHOOK_SECRET already set — skipped");
} else {
  env = upsertEnvKey(env, "GITHUB_WEBHOOK_SECRET", githubSecret);
  console.log("[wiring:secrets] Set GITHUB_WEBHOOK_SECRET");
}

writeFileSync(envPath, env, "utf8");

console.log("\nNext steps:");
console.log("1. Restart pnpm dev");
console.log("2. SigNoz webhook → use SIGNOZ_WEBHOOK_PUBLIC_URL from .env");
console.log("3. GitHub webhook secret must match GITHUB_WEBHOOK_SECRET");
console.log("4. Open /settings → Integration Health");
