import { logger } from "@repo/logger";

import { getSignozConfig, isSignozConfigured } from "../signoz-env";
import type { InvestigationContext } from "../investigation/types";
import { OBI_METRIC_CANDIDATES, obiMetricToEvidence } from "./obi-metrics";

export type MetricSample = {
  metricName: string;
  value: number;
  timestamp: string;
};

type QueryRangeResponse = {
  data?: {
    result?: Array<{
      table?: { rows?: Array<Record<string, unknown>> };
      series?: Array<{
        labels?: Record<string, string>;
        values?: Array<{ timestamp?: number; value?: string | number }>;
      }>;
    }>;
  };
};

/** Kernel/network metrics commonly exported via eBPF collectors into SigNoz/Prometheus */
const EBPF_METRIC_CANDINATES = [
  "signoz_tcp_retransmits_total",
  "tcp_retransmits_total",
  "node_netstat_Tcp_RetransSegs",
  "ebpf_tcp_retransmit_total",
  "signoz_connection_latency_seconds",
  "ebpf_connect_latency_seconds",
  "process_runtime_go_goroutines",
  ...OBI_METRIC_CANDIDATES,
] as const;

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

export async function querySignozMetricRange(input: {
  metricName: string;
  serviceName?: string;
  startMs: number;
  endMs: number;
}): Promise<MetricSample[]> {
  const config = getSignozConfig();
  if (!config) return [];

  const filterParts = [`metric_name = '${input.metricName.replace(/'/g, "''")}'`];
  if (input.serviceName) {
    filterParts.push(`service.name = '${input.serviceName.replace(/'/g, "''")}'`);
  }

  const body = {
    start: input.startMs,
    end: input.endMs,
    requestType: "time_series",
    compositeQuery: {
      queries: [
        {
          type: "builder_query",
          spec: {
            name: "A",
            signal: "metrics",
            filter: { expression: filterParts.join(" AND ") },
            aggregations: [{ metricName: input.metricName, timeAggregation: "avg", spaceAggregation: "sum" }],
            limit: 10,
            offset: 0,
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

    if (!response.ok) return [];

    const json = (await response.json()) as QueryRangeResponse;
    const series = json.data?.result?.[0]?.series ?? [];
    const samples: MetricSample[] = [];

    for (const s of series) {
      const latest = s.values?.[s.values.length - 1];
      if (!latest?.timestamp) continue;
      const value = Number(latest.value);
      if (!Number.isFinite(value)) continue;
      samples.push({
        metricName: input.metricName,
        value,
        timestamp: new Date(latest.timestamp).toISOString(),
      });
    }

    return samples;
  } catch (err) {
    logger.debug("SigNoz metric query failed", {
      metric: input.metricName,
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function metricToEvidence(
  sample: MetricSample,
  service: string,
): InvestigationContext["evidence"][number] | null {
  const obiEvidence = obiMetricToEvidence(sample, service);
  if (obiEvidence) return obiEvidence;

  const name = sample.metricName.toLowerCase();

  if (name.includes("retransmit")) {
    return {
      id: `ebpf-metric-${sample.metricName}`,
      kind: "EBPF",
      title: "TCP retransmit rate elevated (SigNoz metric)",
      detail: `${service}: ${sample.metricName} = ${sample.value.toFixed(2)} in incident window — kernel-level signal from observability backend.`,
      occurredAt: sample.timestamp,
      source: "signoz-metrics",
    };
  }

  if (name.includes("connect") || name.includes("latency")) {
    return {
      id: `ebpf-metric-${sample.metricName}`,
      kind: "EBPF",
      title: "Connection latency elevated (SigNoz metric)",
      detail: `${service}: ${sample.metricName} = ${sample.value.toFixed(4)} — socket/connect path degradation detected via metrics pipeline.`,
      occurredAt: sample.timestamp,
      source: "signoz-metrics",
    };
  }

  if (name.includes("goroutine") || name.includes("pool")) {
    return {
      id: `ebpf-metric-${sample.metricName}`,
      kind: "EBPF",
      title: "Runtime pressure signal (SigNoz metric)",
      detail: `${service}: ${sample.metricName} = ${sample.value.toFixed(0)} — possible pool/goroutine pressure correlating with tail latency.`,
      occurredAt: sample.timestamp,
      source: "signoz-metrics",
    };
  }

  return null;
}

/** Query SigNoz metrics API for real kernel/network/OBI signals. Returns empty if none configured. */
export async function enrichEbpfFromSignozMetrics(input: {
  service: string;
  startMs: number;
  endMs: number;
}): Promise<InvestigationContext["evidence"]> {
  if (!isSignozConfigured()) return [];

  const evidence: InvestigationContext["evidence"] = [];

  for (const metricName of EBPF_METRIC_CANDINATES) {
    const samples = await querySignozMetricRange({
      metricName,
      serviceName: input.service,
      startMs: input.startMs,
      endMs: input.endMs,
    });

    for (const sample of samples) {
      const item = metricToEvidence(sample, input.service);
      if (item) evidence.push(item);
    }
  }

  return evidence;
}
