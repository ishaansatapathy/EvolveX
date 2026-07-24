import { performance } from "node:perf_hooks";

import { generateCollectorConfig } from "../telemetry-intelligence/collector/config-generator";
import { computeEvidenceCompleteness } from "../investigation/evidence-completeness";
import { buildIncidentNarrative } from "../investigation/incident-narrative";
import { getPipelineCacheTtlMs } from "../investigation/pipeline-cache";

export type BenchmarkResult = {
  name: string;
  durationMs: number;
  notes?: string;
};

export type BenchmarkSuiteResult = {
  generatedAt: string;
  environment: string;
  results: BenchmarkResult[];
  summary: string;
};

function measure(name: string, fn: () => void | Promise<void>): Promise<BenchmarkResult> {
  const start = performance.now();
  return Promise.resolve(fn()).then(() => ({
    name,
    durationMs: Math.round((performance.now() - start) * 10) / 10,
  }));
}

/** Feature #41 — repeatable micro-benchmarks for core investigation paths. */
export async function runBenchmarkSuite(): Promise<BenchmarkSuiteResult> {
  const timeline = Array.from({ length: 120 }, (_, index) => ({
    id: `t-${index}`,
    kind: index % 5 === 0 ? "ALERT" : "TRACE",
    title: `Event ${index}`,
    detail: "Synthetic benchmark event",
    occurredAt: new Date(Date.now() - index * 60_000).toISOString(),
    source: "benchmark",
    sourceRef: {},
    sortOrder: index,
    metadata: {},
  }));

  const results = await Promise.all([
    measure("collector_config_generation", () => {
      generateCollectorConfig({
        evolvexApiUrl: "http://localhost:8000",
        signozOtlpEndpoint: "ingest.signoz.cloud:4317",
        services: ["payments-svc", "checkout-api"],
        activePolicies: [
          {
            serviceName: "payments-svc",
            mode: "incident",
            sampleRate: 1,
            reason: "benchmark",
            expiresAt: new Date(Date.now() + 60_000),
            triggerSource: "benchmark",
          },
        ],
        namespaces: [
          { name: "production", sampleRatePct: 100 },
          { name: "dev", sampleRatePct: 15 },
        ],
      });
    }),
    measure("evidence_completeness", () => {
      computeEvidenceCompleteness({
        timeline: timeline as never,
        changeEvents: [],
        investigationContext: null,
        status: "ready",
      });
    }),
    measure("incident_narrative", () => {
      buildIncidentNarrative({
        timeline: timeline.slice(0, 40) as never,
        citations: { citations: [] },
        primaryService: "payments-svc",
      });
    }),
    measure("pipeline_cache_ttl_lookup", () => {
      getPipelineCacheTtlMs();
    }),
  ]);

  const slowest = [...results].sort((a, b) => b.durationMs - a.durationMs)[0];
  return {
    generatedAt: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? "development",
    results,
    summary: slowest
      ? `Slowest: ${slowest.name} (${slowest.durationMs} ms)`
      : "Benchmark suite completed",
  };
}
