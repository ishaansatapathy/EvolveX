import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import type { Request, Response, NextFunction } from "express";
import * as trpcExpress from "@trpc/server/adapters/express";
import { generateOpenApiDocument, createOpenApiExpressMiddleware } from "trpc-to-openapi";
import { serverRouter, openApiRouter, createContext } from "@repo/trpc/server";
import { logger } from "@repo/logger";

import { env } from "./env";
import { createTrpcRateLimitMiddleware } from "./middleware/rate-limiters";
import { googleAuthRouter } from "./routes/google-auth";
import { signozWebhookRouter } from "./routes/signoz-webhook";
import { githubWebhookRouter } from "./routes/github-webhook";
import { kubernetesWebhookRouter } from "./routes/kubernetes-webhook";
import { ebpfWebhookRouter } from "./routes/ebpf-webhook";

export const app = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

function normalizeOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function trustedOrigins() {
  return new Set(
    [env.CLIENT_URL, env.BASE_URL, "http://localhost:3000", "http://localhost:8000"]
      .map((value) => normalizeOrigin(value))
      .filter((value): value is string => Boolean(value)),
  );
}

function requireTrustedOrigin(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();

  const hasCookieAuth = Boolean(req.headers.cookie);
  const origin = normalizeOrigin(req.headers.origin);
  const referer = normalizeOrigin(req.headers.referer);
  const observed = origin ?? referer;

  if (observed && !trustedOrigins().has(observed)) {
    return res.status(403).json({ error: "Untrusted request origin" });
  }

  if (!observed && hasCookieAuth) {
    return res.status(403).json({ error: "Missing request origin" });
  }

  if (hasCookieAuth && req.headers["x-evolvex-csrf"] !== "1") {
    return res.status(403).json({ error: "Missing CSRF header" });
  }

  return next();
}

function buildOpenApiDocument() {
  return generateOpenApiDocument(openApiRouter, {
    title: "Evolvex API",
    version: "1.0.0",
    baseUrl: env.BASE_URL.concat("/api"),
  });
}

let cachedOpenApiDocument: ReturnType<typeof buildOpenApiDocument> | null = null;

function getOpenApiDocument() {
  if (!cachedOpenApiDocument) {
    cachedOpenApiDocument = buildOpenApiDocument();
  }
  return cachedOpenApiDocument;
}

app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  }),
);

app.use("/webhooks/signoz", express.json({ limit: "512kb" }), signozWebhookRouter);
app.use("/webhooks/github", githubWebhookRouter);
app.use("/webhooks/kubernetes", express.json({ limit: "512kb" }), kubernetesWebhookRouter);
app.use("/webhooks/ebpf", express.json({ limit: "512kb" }), ebpfWebhookRouter);

app.use(requireTrustedOrigin);
app.use(cookieParser());
app.use(express.json({ limit: "256kb" }));

app.get("/", (_req, res) => {
  return res.json({
    message: "Evolvex API is up and running",
    health: `${env.BASE_URL}/health`,
    docs: `${env.BASE_URL}/openapi.json`,
  });
});

app.get("/health", async (_req, res) => {
  const checkDatabase = process.env.HEALTH_CHECK_DATABASE !== "false";
  try {
    if (checkDatabase) {
      const { pingDatabase } = await import("@repo/database/health");
      await pingDatabase();
    }
    return res.json({
      message: "Evolvex API is healthy",
      healthy: true,
      ...(checkDatabase ? { database: "ok" as const } : {}),
    });
  } catch (error) {
    logger.error("Health check failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(503).json({
      message: "Evolvex API is unhealthy",
      healthy: false,
      database: "error",
    });
  }
});

app.get("/openapi.json", (_req, res) => {
  try {
    return res.json(getOpenApiDocument());
  } catch (error) {
    logger.error("OpenAPI document unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(503).json({ error: "OpenAPI document unavailable" });
  }
});

app.use("/auth", googleAuthRouter);

const trpcRateLimit = createTrpcRateLimitMiddleware();

try {
  app.use(
    "/api",
    trpcRateLimit,
    createOpenApiExpressMiddleware({
      router: serverRouter,
      createContext,
    }),
  );
} catch (error) {
  logger.warn("OpenAPI REST middleware disabled", {
    message: error instanceof Error ? error.message : String(error),
  });
}

app.use(
  "/trpc",
  trpcRateLimit,
  trpcExpress.createExpressMiddleware({
    router: serverRouter,
    createContext,
  }),
);

export default app;

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error("Unhandled Express error", {
    path: req.path,
    message: err.message,
  });
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});
