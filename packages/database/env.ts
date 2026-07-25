import { z } from "zod";

function emptyToUndefined(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const envSchema = z.object({
  DATABASE_URL: z.preprocess(
    emptyToUndefined,
    z.string().min(1),
  ).describe("Postgres URL — Neon pooled connection for the app"),
  DATABASE_URL_UNPOOLED: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ).describe("Neon direct (non-pooler) URL — use for drizzle-kit migrate"),
});

function createEnv(env: NodeJS.ProcessEnv) {
  const safeParseResult = envSchema.safeParse(env);
  if (!safeParseResult.success) {
    const detail = safeParseResult.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid database environment: ${detail}`);
  }
  return safeParseResult.data;
}

export const env = createEnv(process.env);
