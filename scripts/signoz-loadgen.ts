import "dotenv/config";

import {
  loadGeneratorConfigFromEnv,
  SignozLoadGenerator,
} from "../packages/services/signoz/load-generator.ts";
import { ingestMetrics, ingestTraces } from "../packages/services/signoz/otel-ingest.ts";
import { getDefaultServiceName } from "../packages/services/signoz-env.ts";

function parseArgs() {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const spikeOnly = args.includes("--spike");
  const p99Only = args.includes("--p99");
  const continuous = args.includes("--continuous") || (!once && !spikeOnly && !p99Only);
  return { once, spikeOnly, p99Only, continuous };
}

async function runOnce(mode: "baseline" | "spike" | "p99") {
  const ingestionKey = process.env.SIGNOZ_INGESTION_KEY?.trim();
  if (!ingestionKey) {
    throw new Error("SIGNOZ_INGESTION_KEY is required for production telemetry.");
  }

  const serviceName = getDefaultServiceName();
  const config = { ingestionKey, ingestionUrl: process.env.SIGNOZ_INGESTION_URL };

  if (mode === "p99") {
    await ingestTraces(config, {
      serviceName,
      errorCount: 0,
      fastSuccessCount: 20,
      tailLatencyCount: 3,
      tailLatencyMs: Number.parseInt(process.env.SIGNOZ_LOAD_SPIKE_TAIL_MS ?? "4800", 10),
    });
    console.log(`Tail latency batch sent for ${serviceName} (many ~100ms + few ~4.8s requests).`);
    console.log("SigNoz computes p95/p99 from these traces — configure a p99 latency alert in SigNoz to trigger Evolvex.");
    return;
  }

  if (mode === "spike") {
    await ingestTraces(config, {
      serviceName,
      errorCount: 3,
      fastSuccessCount: 10,
      tailLatencyCount: 2,
      tailLatencyMs: 4800,
    });
    await ingestMetrics(config, serviceName, 12);
    console.log(`Spike sent for ${serviceName} (errors + tail latency + signoz_calls_total)`);
    return;
  }

  await ingestTraces(config, { serviceName, errorCount: 0, fastSuccessCount: 8 });
  console.log(`Baseline fast traces sent for ${serviceName}`);
}

async function main() {
  const { once, spikeOnly, p99Only, continuous } = parseArgs();

  if (p99Only) {
    await runOnce("p99");
    return;
  }

  if (once || spikeOnly) {
    await runOnce(spikeOnly ? "spike" : "baseline");
    return;
  }

  if (!continuous) {
    console.log("Usage:");
    console.log("  pnpm signoz:loadgen              # continuous baseline + periodic spikes");
    console.log("  pnpm signoz:loadgen --once       # one baseline batch");
    console.log("  pnpm signoz:loadgen --spike      # error + tail latency spike");
    console.log("  pnpm signoz:loadgen --p99        # tail latency only (SigNoz computes p99)");
    return;
  }

  const config = loadGeneratorConfigFromEnv();
  if (!config) {
    throw new Error("SIGNOZ_INGESTION_KEY is required. Set it in .env for SigNoz Cloud ingestion.");
  }

  const generator = new SignozLoadGenerator(config);
  generator.start();

  console.log("Production load generator running (Ctrl+C to stop)");
  console.log(`Service: ${config.serviceName}`);
  console.log(`Baseline every ${config.baselineIntervalMs}ms | Spike every ${config.spikeIntervalMs}ms`);
  console.log("SigNoz calculates p95/p99 — Evolvex investigates when those alerts fire.");

  const heartbeat = setInterval(() => {
    const stats = generator.getStats();
    console.log(
      `[loadgen] ticks=${stats.ticks} spikes=${stats.spikes} uptime=${Math.round(stats.uptimeMs / 1000)}s` +
        (stats.lastError ? ` lastError=${stats.lastError}` : ""),
    );
  }, 30_000);

  const shutdown = () => {
    clearInterval(heartbeat);
    generator.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
