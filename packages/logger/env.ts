import { z } from "zod";

function emptyToUndefined(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const envSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(["development", "production", "prod", "test"]).default("development"),
  ),
  LOGGER_LEVEL: z.preprocess(
    emptyToUndefined,
    z.enum(["error", "debug", "info"]).optional(),
  ),
});

function formatEnvError(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

function createEnv(env: NodeJS.ProcessEnv) {
  const safeParseResult = envSchema.safeParse(env);
  if (!safeParseResult.success) throw new Error(formatEnvError(safeParseResult.error));
  return safeParseResult.data;
}

export const env = createEnv(process.env);
