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
  const continuous = args.includes("--continuous") || (!once && !spikeOnly);
  return { once, spikeOnly, continuous };
}

async function runOnce(spikeOnly: boolean) {
  const ingestionKey = process.env.SIGNOZ_INGESTION_KEY?.trim();
  if (!ingestionKey) {
    throw new Error("SIGNOZ_INGESTION_KEY is required for production telemetry.");
  }

  const serviceName = getDefaultServiceName();
  const config = { ingestionKey, ingestionUrl: process.env.SIGNOZ_INGESTION_URL };

  if (spikeOnly) {
    await ingestTraces(config, { serviceName, errorCount: 5, successCount: 1 });
    await ingestMetrics(config, serviceName, 12);
    console.log(`Spike sent for ${serviceName} (errors + signoz_calls_total)`);
    return;
  }

  await ingestTraces(config, { serviceName, errorCount: 0, successCount: 2 });
  console.log(`Baseline traces sent for ${serviceName}`);
}

async function main() {
  const { once, spikeOnly, continuous } = parseArgs();

  if (once || spikeOnly) {
    await runOnce(spikeOnly);
    return;
  }

  if (!continuous) {
    console.log("Usage:");
    console.log("  pnpm signoz:loadgen              # continuous baseline + periodic spikes");
    console.log("  pnpm signoz:loadgen --once       # one baseline batch");
    console.log("  pnpm signoz:loadgen --spike      # one error spike + metric bump");
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
