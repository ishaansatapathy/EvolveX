import { logger } from "@repo/logger";

import { getSignozConfig, isSignozConfigured } from "../signoz-env";
import type { SignozLogRow, SignozTraceRow } from "./types";

type QueryRangeResponse = {
  data?: {
    result?: Array<{
      table?: {
        rows?: Array<Record<string, unknown>>;
      };
    }>;
    data?: {
      results?: Array<{
        rows?: Array<{ data?: Record<string, unknown>; timestamp?: string } | Record<string, unknown>> | null;
      }>;
    };
  };
};

/** Normalizes SigNoz v5 query_range rows (legacy table layout + current nested `data` rows). */
export function extractQueryRangeRows(json: QueryRangeResponse): Record<string, unknown>[] {
  const legacyRows = json.data?.result?.[0]?.table?.rows;
  if (legacyRows?.length) return legacyRows;

  const modernRows = json.data?.data?.results?.[0]?.rows;
  if (!modernRows?.length) return [];

  return modernRows.map((row) => {
    if (row && typeof row === "object" && "data" in row && row.data && typeof row.data === "object") {
      const nested = row.data as Record<string, unknown>;
      const timestamp = (row as { timestamp?: string }).timestamp;
      return timestamp && !nested.timestamp ? { ...nested, timestamp } : nested;
    }
    return row as Record<string, unknown>;
  });
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function rowValue(row: Record<string, unknown>, key: string): unknown {
  if (key in row) return row[key];
  const alt = key.replace(/\./g, "_");
  if (alt in row) return row[alt];
  return undefined;
}

function parseTraceRow(row: Record<string, unknown>): SignozTraceRow {
  const durationRaw = rowValue(row, "durationNano") ?? rowValue(row, "duration_nano");
  const durationMs =
    typeof durationRaw === "number" ? Math.round(durationRaw / 1_000_000) : undefined;

  return {
    traceId: String(rowValue(row, "traceID") ?? rowValue(row, "trace_id") ?? ""),
    spanId: String(rowValue(row, "spanID") ?? rowValue(row, "span_id") ?? ""),
    serviceName: String(rowValue(row, "service.name") ?? rowValue(row, "service_name") ?? ""),
    name: String(rowValue(row, "name") ?? rowValue(row, "span_name") ?? "span"),
    durationMs,
    hasError: Boolean(rowValue(row, "hasError") ?? rowValue(row, "has_error")),
    timestamp: String(rowValue(row, "timestamp") ?? ""),
  };
}

function parseLogRow(row: Record<string, unknown>): SignozLogRow {
  return {
    timestamp: String(rowValue(row, "timestamp") ?? ""),
    body: String(rowValue(row, "body") ?? rowValue(row, "message") ?? ""),
    severityText: String(rowValue(row, "severity_text") ?? rowValue(row, "severityText") ?? "INFO"),
    serviceName: String(rowValue(row, "service.name") ?? rowValue(row, "service_name") ?? ""),
    traceId: String(rowValue(row, "trace_id") ?? rowValue(row, "traceID") ?? ""),
  };
}

export class SignozClient {
  isConfigured() {
    return isSignozConfigured();
  }

  async searchErrorTraces(input: {
    serviceName?: string;
    startMs: number;
    endMs: number;
    limit?: number;
  }): Promise<SignozTraceRow[]> {
    return this.searchTraces({
      ...input,
      filterParts: ["has_error = true", "parent_span_id = ''"],
      orderKey: "timestamp",
    });
  }

  async searchSlowTraces(input: {
    serviceName?: string;
    startMs: number;
    endMs: number;
    limit?: number;
    minDurationMs?: number;
  }): Promise<SignozTraceRow[]> {
    const minDurationMs = input.minDurationMs ?? Number.parseInt(process.env.SIGNOZ_SLOW_TRACE_MS ?? "800", 10);
    const minDurationNano = Math.max(1, minDurationMs) * 1_000_000;

    return this.searchTraces({
      serviceName: input.serviceName,
      startMs: input.startMs,
      endMs: input.endMs,
      limit: input.limit,
      filterParts: [`durationNano > ${minDurationNano}`, "parent_span_id = ''"],
      orderKey: "durationNano",
      orderDirection: "desc",
    });
  }

  async searchTracesInWindow(input: {
    serviceName?: string;
    startMs: number;
    endMs: number;
    limit?: number;
  }): Promise<SignozTraceRow[]> {
    return this.searchTraces({
      ...input,
      filterParts: ["parent_span_id = ''"],
      orderKey: "timestamp",
    });
  }

  async searchLogs(input: {
    serviceName?: string;
    startMs: number;
    endMs: number;
    limit?: number;
  }): Promise<SignozLogRow[]> {
    const config = getSignozConfig();
    if (!config) return [];

    const filterParts = ["severity_text EXISTS"];
    if (input.serviceName) {
      filterParts.push(`service.name = '${input.serviceName.replace(/'/g, "''")}'`);
    }

    const body = {
      start: input.startMs,
      end: input.endMs,
      requestType: "raw",
      compositeQuery: {
        queries: [
          {
            type: "builder_query",
            spec: {
              name: "A",
              signal: "logs",
              filter: { expression: filterParts.join(" AND ") },
              selectFields: [
                { name: "timestamp" },
                { name: "body" },
                { name: "severity_text" },
                { name: "service.name", fieldContext: "resource" },
                { name: "trace_id" },
              ],
              limit: input.limit ?? 50,
              offset: 0,
              order: [{ key: { name: "timestamp" }, direction: "desc" }],
            },
          },
        ],
      },
    };

    const url = `${normalizeBaseUrl(config.cloudUrl)}/api/v5/query_range`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "SIGNOZ-API-KEY": config.apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        logger.warn("SigNoz logs query_range failed", {
          status: response.status,
          body: text.slice(0, 500),
        });
        return [];
      }

      const json = (await response.json()) as QueryRangeResponse;
      const rows = extractQueryRangeRows(json);
      return rows.map((row) => parseLogRow(row));
    } catch (err) {
      logger.warn("SigNoz logs query_range error", {
        message: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const config = getSignozConfig();
    if (!config) return { ok: false, message: "SigNoz API not configured" };

    const url = `${normalizeBaseUrl(config.cloudUrl)}/api/v1/service_accounts/me`;
    try {
      const response = await fetch(url, {
        headers: { "SIGNOZ-API-KEY": config.apiKey },
      });
      if (!response.ok) {
        return { ok: false, message: `SigNoz API returned ${response.status}` };
      }
      return { ok: true, message: "SigNoz API connected" };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "SigNoz connection failed",
      };
    }
  }

  private async searchTraces(input: {
    serviceName?: string;
    startMs: number;
    endMs: number;
    limit?: number;
    filterParts: string[];
    orderKey: "timestamp" | "durationNano";
    orderDirection?: "asc" | "desc";
  }): Promise<SignozTraceRow[]> {
    const config = getSignozConfig();
    if (!config) return [];

    const filterParts = [...input.filterParts];
    if (input.serviceName) {
      filterParts.push(`service.name = '${input.serviceName.replace(/'/g, "''")}'`);
    }

    const body = {
      start: input.startMs,
      end: input.endMs,
      requestType: "raw",
      compositeQuery: {
        queries: [
          {
            type: "builder_query",
            spec: {
              name: "A",
              signal: "traces",
              filter: {
                expression: filterParts.join(" AND "),
              },
              selectFields: [
                { name: "service.name", fieldContext: "resource" },
                { name: "name" },
                { name: "durationNano" },
                { name: "hasError" },
                { name: "traceID" },
                { name: "spanID" },
                { name: "timestamp" },
              ],
              limit: input.limit ?? 20,
              offset: 0,
              order: [
                {
                  key: { name: input.orderKey },
                  direction: input.orderDirection ?? "desc",
                },
              ],
            },
          },
        ],
      },
    };

    const url = `${normalizeBaseUrl(config.cloudUrl)}/api/v5/query_range`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "SIGNOZ-API-KEY": config.apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        logger.warn("SigNoz query_range failed", {
          status: response.status,
          body: text.slice(0, 500),
        });
        return [];
      }

      const json = (await response.json()) as QueryRangeResponse;
      const rows = extractQueryRangeRows(json);
      return rows.map((row) => parseTraceRow(row));
    } catch (err) {
      logger.warn("SigNoz query_range error", {
        message: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}

export const signozClient = new SignozClient();
