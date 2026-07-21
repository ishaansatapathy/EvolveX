import { z } from "zod";

function normalizeEnvUrl(value: string) {
  return value.trim().replace(/^["']+|["']+$/g, "").replace(/\/$/, "");
}

function emptyToUndefined(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const envSchema = z.object({
  PORT: z.string().optional(),
  NODE_ENV: z.enum(["development", "prod", "production", "test"]).default("development"),
  BASE_URL: z.string().default("http://localhost:8000"),
  CLIENT_URL: z.string().default("http://localhost:3000"),
  OPENAPI_DOCS_SECRET: z.preprocess(emptyToUndefined, z.string().min(8).optional()),
  PUBLIC_OPENAPI_DOCS: z.enum(["true", "false"]).optional(),
  CORSAIR_WEBHOOK_SECRET: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
});

function defaultPublicOpenApiDocs(nodeEnv: string) {
  if (nodeEnv === "development" || nodeEnv === "test") return "true";
  const baseUrl = (process.env.BASE_URL ?? "").toLowerCase();
  if (baseUrl.includes("vercel.app") || baseUrl.includes("railway.app")) return "true";
  return "false";
}

function createEnv(env: NodeJS.ProcessEnv) {
  const safeParseResult = envSchema.safeParse(env);
  if (!safeParseResult.success) throw new Error(safeParseResult.error.message);
  const data = safeParseResult.data;
  return {
    ...data,
    BASE_URL: normalizeEnvUrl(data.BASE_URL),
    CLIENT_URL: normalizeEnvUrl(data.CLIENT_URL),
    PUBLIC_OPENAPI_DOCS: data.PUBLIC_OPENAPI_DOCS ?? defaultPublicOpenApiDocs(data.NODE_ENV),
  };
}

export const env = createEnv(process.env);
