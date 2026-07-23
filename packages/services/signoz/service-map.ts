import { logger } from "@repo/logger";

import { getSignozConfig, isSignozConfigured } from "../signoz-env";
import { signozClient } from "./client";

export type SignozServiceNode = {
  name: string;
  healthy: boolean;
  latencyMs: number | null;
};

export type SignozServiceEdge = {
  source: string;
  destination: string;
  healthy: boolean;
  latencyMs: number | null;
};

type ServicesResponse = {
  data?: Array<{
    serviceName?: string;
    p99?: number;
    errorRate?: number;
    numCalls?: number;
  }>;
};

type DependencyResponse = {
  data?: Array<{
    parent?: string;
    child?: string;
    callCount?: number;
    errorRate?: number;
    p99?: number;
  }>;
};

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    const text = await response.text().catch(() => "");
    logger.debug("SigNoz API returned non-JSON", { contentType, preview: text.slice(0, 120) });
    return null;
  }
  return (await response.json()) as T;
}

/** Derive service nodes from live traces when v1 services API is unavailable. */
export async function fetchServicesFromTraces(input?: {
  service?: string;
}): Promise<SignozServiceNode[]> {
  const end = Date.now();
  const start = end - 60 * 60 * 1000;

  const traces = await signozClient.searchTracesInWindow({
    serviceName: input?.service,
    startMs: start,
    endMs: end,
    limit: 100,
  });

  const byService = new Map<string, { count: number; errors: number; maxDuration: number }>();

  for (const trace of traces) {
    const name = trace.serviceName?.trim() || "unknown";
    const entry = byService.get(name) ?? { count: 0, errors: 0, maxDuration: 0 };
    entry.count += 1;
    if (trace.hasError) entry.errors += 1;
    entry.maxDuration = Math.max(entry.maxDuration, trace.durationMs ?? 0);
    byService.set(name, entry);
  }

  return [...byService.entries()].map(([name, stats]) => ({
    name,
    healthy: stats.errors / Math.max(stats.count, 1) < 0.05,
    latencyMs: stats.maxDuration > 0 ? stats.maxDuration : null,
  }));
}

/** Fetch service list from SigNoz — falls back to trace-derived services. */
export async function fetchSignozServices(): Promise<SignozServiceNode[]> {
  const config = getSignozConfig();
  if (!config) return [];

  const end = Date.now();
  const start = end - 60 * 60 * 1000;
  const url = `${normalizeBaseUrl(config.cloudUrl)}/api/v1/services?start=${start}&end=${end}`;

  try {
    const response = await fetch(url, {
      headers: {
        "SIGNOZ-API-KEY": config.apiKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return fetchServicesFromTraces();
    }

    const json = await parseJsonResponse<ServicesResponse>(response);
    if (!json?.data?.length) {
      return fetchServicesFromTraces();
    }

    return json.data.map((svc) => ({
      name: svc.serviceName ?? "unknown",
      healthy: (svc.errorRate ?? 0) < 0.05,
      latencyMs: svc.p99 != null ? Math.round(svc.p99 / 1_000_000) : null,
    }));
  } catch (err) {
    logger.debug("SigNoz services API failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return fetchServicesFromTraces();
  }
}

/** Fetch service dependency edges from SigNoz */
export async function fetchSignozDependencies(input?: {
  service?: string;
}): Promise<SignozServiceEdge[]> {
  const config = getSignozConfig();
  if (!config) return [];

  const end = Date.now();
  const start = end - 60 * 60 * 1000;
  const params = new URLSearchParams({ start: String(start), end: String(end) });
  if (input?.service) params.set("service", input.service);

  const url = `${normalizeBaseUrl(config.cloudUrl)}/api/v1/dependency_graph?${params}`;

  try {
    const response = await fetch(url, {
      headers: {
        "SIGNOZ-API-KEY": config.apiKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) return [];

    const json = await parseJsonResponse<DependencyResponse>(response);
    if (!json?.data?.length) return [];

    return json.data.map((edge) => ({
      source: edge.parent ?? "unknown",
      destination: edge.child ?? "unknown",
      healthy: (edge.errorRate ?? 0) < 0.05,
      latencyMs: edge.p99 != null ? Math.round(edge.p99 / 1_000_000) : null,
    }));
  } catch (err) {
    logger.debug("SigNoz dependency graph API failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export function isSignozServiceMapAvailable() {
  return isSignozConfigured();
}
