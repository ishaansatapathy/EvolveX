import http from "node:http";

import "./register-otel";

const PORT = Number(process.env.PORT ?? 8000);

function writeJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function bootstrap() {
  let expressHandler: http.RequestListener | null = null;

  const server = http.createServer((req, res) => {
    const path = req.url?.split("?")[0] ?? "/";

    if (path === "/health" || path === "/") {
      writeJson(res, 200, {
        healthy: true,
        ready: Boolean(expressHandler),
        message: expressHandler ? "Evolvex API is healthy" : "Evolvex API is starting",
      });
      return;
    }

    if (!expressHandler) {
      writeJson(res, 503, {
        error: "Evolvex API is starting",
        hint: "Wait a few seconds, or check DATABASE_URL (Neon) / pnpm db:up for local Postgres",
      });
      return;
    }

    expressHandler(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "0.0.0.0", () => resolve());
  });

  const { logger } = await import("@repo/logger");
  logger.info(`Evolvex API listening on 0.0.0.0:${PORT}`);

  try {
    const { runApiBootstrap } = await import("./api-bootstrap");
    await runApiBootstrap({ serverless: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("API bootstrap failed — /health stays up; fix env and redeploy", { err, message });
  }

  try {
    const { app } = await import("./server");
    expressHandler = app;
    logger.info("Express application loaded");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to load Express application", { err, message });
    return;
  }
}

bootstrap().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Fatal bootstrap error:", message);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  console.error(
    "Check Railway env vars: DATABASE_URL, JWT_SECRET (16+ chars), JWT_REFRESH_SECRET, " +
      "SIGNOZ_WEBHOOK_SECRET, GITHUB_WEBHOOK_SECRET, NODE_ENV=production",
  );
  process.exit(1);
});
