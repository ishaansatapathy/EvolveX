import "dotenv/config";

import { eq } from "@repo/database";
import { db } from "@repo/database";
import { investigationsTable } from "@repo/database/schema";
import InvestigationService from "@repo/services/investigation";
import type { SignozWebhookPayload } from "@repo/services/signoz/types";

import { ingestCrossServiceCheckoutTraces, ingestLogs, ingestTraces } from "../packages/services/signoz/otel-ingest.ts";
import { getDefaultServiceName } from "../packages/services/signoz-env.ts";

function buildDemoAlertPayload(serviceName: string): SignozWebhookPayload {
  const now = new Date();
  const startsAt = new Date(now.getTime() - 5 * 60_000).toISOString();

  return {
    receiver: "evolvex-demo",
    status: "firing",
    alerts: [
      {
        status: "firing",
        labels: {
          alertname: "HighP99Latency",
          severity: "critical",
          "service.name": serviceName,
        },
        annotations: {
          summary: `p99 latency above 800ms for ${serviceName}`,
          info: "Demo incident — checkout-api tail latency with Redis timeouts and inventory lock contention.",
        },
        startsAt,
        fingerprint: `demo-${Date.now()}`,
      },
    ],
    commonLabels: {
      severity: "critical",
    },
  };
}

async function waitForPipeline(investigationId: string, timeoutMs = 120_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const [row] = await db
      .select({ status: investigationsTable.status, incidentId: investigationsTable.incidentId })
      .from(investigationsTable)
      .where(eq(investigationsTable.id, investigationId))
      .limit(1);

    if (row?.status === "ready" || row?.status === "failed") {
      return row;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return null;
}

async function main() {
  const ingestionKey = process.env.SIGNOZ_INGESTION_KEY?.trim();
  if (!ingestionKey) {
    throw new Error("SIGNOZ_INGESTION_KEY is required. Add it to .env before running demo:incident.");
  }

  const serviceName = getDefaultServiceName();
  const config = { ingestionKey, ingestionUrl: process.env.SIGNOZ_INGESTION_URL };
  const tailLatencyMs = Number.parseInt(process.env.SIGNOZ_LOAD_SPIKE_TAIL_MS ?? "4800", 10);

  console.log("[demo:incident] Step 1/4 — Sending demo telemetry to SigNoz…");

  await ingestLogs(config, {
    serviceName,
    entries: [
      { severityText: "ERROR", body: "Redis connection timeout during checkout batch", offsetMs: -1000 },
      { severityText: "WARN", body: "Inventory lock contention on payments-svc", offsetMs: -2000 },
      { severityText: "INFO", body: "Checkout pipeline started", offsetMs: -3000 },
    ],
  });

  await ingestTraces(config, {
    serviceName,
    errorCount: 0,
    fastSuccessCount: 20,
    tailLatencyCount: 3,
    tailLatencyMs,
  });

  await ingestCrossServiceCheckoutTraces(config, {
    downstreamService: serviceName,
    count: 5,
    tailLatencyMs,
  });

  console.log("[demo:incident] Step 2/4 — Waiting 8s for SigNoz indexing…");
  await new Promise((resolve) => setTimeout(resolve, 8000));

  console.log("[demo:incident] Step 3/4 — Firing SigNoz alert webhook…");
  const investigationService = new InvestigationService();
  const { investigationIds } = await investigationService.handleSignozWebhook(
    buildDemoAlertPayload(serviceName),
  );

  if (investigationIds.length === 0) {
    throw new Error("No investigation created. Check INVESTIGATION_OWNER_EMAIL in .env.");
  }

  const investigationId = investigationIds[0]!;
  console.log(`[demo:incident] Step 4/4 — Waiting for pipeline on ${investigationId}…`);

  const row = await waitForPipeline(investigationId);
  const incidentLabel = row?.incidentId ?? investigationId;
  const status = row?.status ?? "timeout";

  console.log("");
  console.log("Demo incident ready.");
  console.log(`  Case:     ${incidentLabel}`);
  console.log(`  Pipeline: ${status}`);
  console.log(`  Open:     http://localhost:3000/investigations`);
  console.log("");
  console.log("Check Story → Evidence → Analysis for cross-service RCA and dependency edges.");
}

main().catch((err) => {
  console.error("[demo:incident] Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
