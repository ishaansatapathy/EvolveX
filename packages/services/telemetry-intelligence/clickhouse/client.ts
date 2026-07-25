import { logger } from "@repo/logger";

import { getTelemetryIntelligenceConfig } from "../config";

function readInt(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type ClickHouseQueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  elapsedMs: number;
};

/** Feature #5 — optional direct ClickHouse HTTP queries (self-hosted SigNoz). */
export async function executeClickHouseQuery(
  sql: string,
  params?: Record<string, string | number>,
): Promise<ClickHouseQueryResult | null> {
  const { clickhouseUrl, clickhouseEnabled } = getTelemetryIntelligenceConfig();
  if (!clickhouseEnabled || !clickhouseUrl) return null;

  const url = new URL(clickhouseUrl);
  url.searchParams.set("default_format", "JSON");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(`param_${key}`, String(value));
    }
  }

  const started = Date.now();
  const timeoutMs = readInt("SIGNOZ_CLICKHOUSE_TIMEOUT_MS", 15_000);

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        ...(process.env.SIGNOZ_CLICKHOUSE_USER
          ? {
              "X-ClickHouse-User": process.env.SIGNOZ_CLICKHOUSE_USER,
              "X-ClickHouse-Key": process.env.SIGNOZ_CLICKHOUSE_PASSWORD ?? "",
            }
          : {}),
      },
      body: sql,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.warn("ClickHouse query failed", {
        status: response.status,
        preview: text.slice(0, 300),
        elapsedMs: Date.now() - started,
      });
      return null;
    }

    const json = (await response.json()) as {
      meta?: Array<{ name: string }>;
      data?: Array<Record<string, unknown>>;
    };

    return {
      columns: json.meta?.map((col) => col.name) ?? [],
      rows: json.data ?? [],
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    logger.debug("ClickHouse query error", {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function queryServiceLatencySummary(input: {
  serviceName: string;
  windowMinutes?: number;
}) {
  const windowMinutes = input.windowMinutes ?? 15;

  return executeClickHouseQuery(
    `
SELECT
  serviceName AS service_name,
  count() AS requests,
  countIf(statusCode = 'Error') AS errors,
  quantile(0.99)(durationNano) / 1000000 AS p99_ms
FROM signoz_traces.signoz_index_v3
WHERE serviceName = {service:String}
  AND timestamp >= now() - INTERVAL {window:UInt32} MINUTE
GROUP BY service_name
LIMIT 1
`.trim(),
    { service: input.serviceName, window: windowMinutes },
  );
}

export async function queryTopFailingEndpoints(input: {
  serviceName: string;
  windowMinutes?: number;
  limit?: number;
}) {
  const windowMinutes = input.windowMinutes ?? 15;
  const limit = input.limit ?? 10;

  return executeClickHouseQuery(
    `
SELECT
  name AS endpoint,
  countIf(statusCode = 'Error') AS error_count,
  quantile(0.99)(durationNano) / 1000000 AS p99_ms
FROM signoz_traces.signoz_index_v3
WHERE serviceName = {service:String}
  AND timestamp >= now() - INTERVAL {window:UInt32} MINUTE
GROUP BY endpoint
ORDER BY error_count DESC
LIMIT {limit:UInt32}
`.trim(),
    { service: input.serviceName, window: windowMinutes, limit },
  );
}
