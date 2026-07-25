import "dotenv/config";

import { createThresholdAlertRule, listNotificationChannels } from "../packages/services/signoz/ops-api.ts";
import { getDefaultServiceName, getSignozConfig } from "../packages/services/signoz-env.ts";

function parseArgs() {
  const args = process.argv.slice(2);
  const channels: string[] = [];
  let serviceName: string | undefined;
  let latencyMs = 800;
  let errorCount = 3;
  let skipLatency = false;
  let skipError = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--channel" && args[i + 1]) {
      channels.push(args[++i]!);
    } else if (arg === "--service" && args[i + 1]) {
      serviceName = args[++i];
    } else if (arg === "--latency-ms" && args[i + 1]) {
      latencyMs = Number.parseInt(args[++i]!, 10);
    } else if (arg === "--error-count" && args[i + 1]) {
      errorCount = Number.parseInt(args[++i]!, 10);
    } else if (arg === "--only-latency") {
      skipError = true;
    } else if (arg === "--only-error") {
      skipLatency = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return { channels, serviceName, latencyMs, errorCount, skipLatency, skipError };
}

function printUsage() {
  console.log(`Usage: pnpm signoz:alert-setup -- --channel <name> [options]

Creates a p99-latency and an error-rate threshold_rule alert in SigNoz for
the given service, mirroring the signoz_create_alert MCP tool (verifies
notification channels exist before creating — see docs/SIGNOZ-MCP.md).

Options:
  --channel <name>      Notification channel to attach (repeatable, required)
  --service <name>      Service name (default: SIGNOZ_DEFAULT_SERVICE_NAME / payments-svc)
  --latency-ms <n>      p99 latency threshold in ms (default: 800)
  --error-count <n>     Error span count threshold per eval window (default: 3)
  --only-latency        Only create the latency alert
  --only-error          Only create the error-rate alert
  --help                Show this help
`);
}

async function main() {
  const { channels, serviceName, latencyMs, errorCount, skipLatency, skipError } = parseArgs();
  const config = getSignozConfig();

  if (!config) {
    throw new Error("SIGNOZ_CLOUD_URL and SIGNOZ_API_KEY must be set (see .env.example).");
  }

  const service = serviceName ?? getDefaultServiceName();

  if (channels.length === 0) {
    const existing = await listNotificationChannels(config);
    console.log("No --channel provided.");
    if (existing.length > 0) {
      console.log(`Existing SigNoz notification channels: ${existing.map((c) => c.name).join(", ")}`);
      console.log("Re-run with: pnpm signoz:alert-setup -- --channel <one-of-the-above>");
    } else {
      console.log("No notification channels exist yet — create one in SigNoz → Settings → Alerts → Notification Channels.");
    }
    process.exit(1);
  }

  console.log(`Setting up alerts for service "${service}" via ${config.cloudUrl} …`);

  if (!skipLatency) {
    try {
      await createThresholdAlertRule({
        alertName: `${service} — p99 latency > ${latencyMs}ms`,
        serviceName: service,
        kind: "latency_p99",
        target: latencyMs,
        channelNames: channels,
      });
      console.log(`✓ Created p99 latency alert (> ${latencyMs}ms)`);
    } catch (err) {
      console.error(`✗ Latency alert failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!skipError) {
    try {
      await createThresholdAlertRule({
        alertName: `${service} — error spans > ${errorCount}`,
        serviceName: service,
        kind: "error_rate",
        target: errorCount,
        channelNames: channels,
      });
      console.log(`✓ Created error-rate alert (> ${errorCount} error spans / 5m)`);
    } catch (err) {
      console.error(`✗ Error-rate alert failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log("");
  console.log(`Open SigNoz → Alerts to review, or run: pnpm signoz:p99 to trigger the latency alert for a live demo.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
