import "dotenv/config";

import { buildDashboardUrl, buildServiceOverviewDashboardPayload, createDashboard } from "../packages/services/signoz/dashboards-api.ts";
import { getDefaultServiceName, getSignozConfig } from "../packages/services/signoz-env.ts";

function parseArgs() {
  const args = process.argv.slice(2);
  let serviceName: string | undefined;
  let title: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--service" && args[i + 1]) {
      serviceName = args[++i];
    } else if (arg === "--title" && args[i + 1]) {
      title = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return { serviceName, title };
}

function printUsage() {
  console.log(`Usage: pnpm signoz:dashboard-setup -- [options]

Creates a "Service Overview" dashboard in SigNoz (request rate, error rate,
p99 latency for one service) via POST /api/v1/dashboards — the same route
Terraform's signoz_dashboard resource uses. Mirrors signoz:alert-setup, so a
generated dashboard and generated alerts agree on what "healthy" means.

Options:
  --service <name>   Service name (default: SIGNOZ_DEFAULT_SERVICE_NAME / payments-svc)
  --title <text>     Dashboard title override
  --help             Show this help
`);
}

async function main() {
  const { serviceName, title } = parseArgs();
  const config = getSignozConfig();

  if (!config) {
    throw new Error("SIGNOZ_CLOUD_URL and SIGNOZ_API_KEY must be set (see .env.example).");
  }

  const service = serviceName ?? getDefaultServiceName();
  console.log(`Creating a service-overview dashboard for "${service}" via ${config.cloudUrl} …`);

  const payload = buildServiceOverviewDashboardPayload(service, title ? { title } : undefined);

  try {
    const created = await createDashboard(payload, config);
    const url = buildDashboardUrl(config, created.id);
    console.log(`✓ Created dashboard "${payload.title}"`);
    console.log(`  ${url}`);
  } catch (err) {
    console.error(`✗ Dashboard creation failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
