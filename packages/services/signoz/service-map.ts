import { logger } from "@repo/logger";

import { getSignozConfig, isSignozConfigured } from "../signoz-env";

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

/** Fetch service list from SigNoz — real dependency graph source */
export async function fetchSignozServices(): Promise<SignozServiceNode[]> {
  const config = getSignozConfig();
  if (!config) return [];

  const end = Date.now();
  const start = end - 60 * 60 * 1000;
  const url = `${normalizeBaseUrl(config.cloudUrl)}/api/v1/services?start=${start}&end=${end}`;

  try {
    const response = await fetch(url, {
      headers: { "SIGNOZ-API-KEY": config.apiKey },
    });

    if (!response.ok) return [];

    const json = (await response.json()) as ServicesResponse;
    return (json.data ?? []).map((svc) => ({
      name: svc.serviceName ?? "unknown",
      healthy: (svc.errorRate ?? 0) < 0.05,
      latencyMs: svc.p99 != null ? Math.round(svc.p99 / 1_000_000) : null,
    }));
  } catch (err) {
    logger.debug("SigNoz services API failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
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
      headers: { "SIGNOZ-API-KEY": config.apiKey },
    });

    if (!response.ok) return [];

    const json = (await response.json()) as DependencyResponse;
    return (json.data ?? []).map((edge) => ({
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
