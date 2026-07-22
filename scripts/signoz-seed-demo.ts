import "dotenv/config";

import InvestigationService from "../packages/services/investigation/index.ts";
import { sendDemoTracesToSignoz } from "../packages/services/signoz/send-demo-traces.ts";

async function main() {
  const ingestionKey = process.env.SIGNOZ_INGESTION_KEY?.trim();

  if (ingestionKey) {
    console.log("Sending production-style error traces to SigNoz Cloud...");
    const result = await sendDemoTracesToSignoz({
      ingestionKey,
      ingestionUrl: process.env.SIGNOZ_INGESTION_URL,
      serviceName: process.env.SIGNOZ_DEFAULT_SERVICE_NAME ?? "payments-svc",
      errorCount: 3,
    });
    console.log(`Ingestion OK (${result.status}) for ${result.serviceName}`);
    console.log("For continuous spikes run: pnpm signoz:loadgen");
    console.log("Waiting 8s for SigNoz indexing...");
    await new Promise((resolve) => setTimeout(resolve, 8000));
  } else {
    console.log("SIGNOZ_INGESTION_KEY not set — using local demo trace seed (SIGNOZ_DEMO_TRACES=true).");
    process.env.SIGNOZ_DEMO_TRACES = "true";
  }

  const service = new InvestigationService();
  const count = await service.rerunAllPipelines();
  console.log(`Refreshed ${count} investigation(s). Open http://localhost:3000/investigations`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
