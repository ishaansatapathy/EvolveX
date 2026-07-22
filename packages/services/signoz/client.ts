import { logger } from "@repo/logger";

import { getSignozConfig, isSignozConfigured } from "../signoz-env";
import type { SignozTraceRow } from "./types";

type QueryRangeResponse = {
  data?: {
    result?: Array<{
      table?: {
        rows?: Array<Record<string, unknown>>;
      };
    }>;
  };
};

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
      const rows = json.data?.result?.[0]?.table?.rows ?? [];
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
