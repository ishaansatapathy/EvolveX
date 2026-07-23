import { eq } from "@repo/database";
import { db } from "@repo/database";
import { investigationsTable } from "@repo/database/schema";
import InvestigationService from "@repo/services/investigation";
import type { SignozWebhookPayload } from "@repo/services/signoz/types";

/**
 * Seeds a real investigation by invoking the same webhook handler used in production.
 * Requires: DATABASE_URL, INVESTIGATION_OWNER_EMAIL (or matching user in DB).
 * Optional: SIGNOZ_* for pipeline enrichment, OPENAI_API_KEY for LLM summary.
 */
function buildSampleAlertPayload(): SignozWebhookPayload {
  const now = new Date();
  const startsAt = new Date(now.getTime() - 5 * 60_000).toISOString();

  return {
    receiver: "evolvex-seed",
    status: "firing",
    alerts: [
      {
        status: "firing",
        labels: {
          alertname: "HighP99Latency",
          severity: "critical",
          "service.name": process.env.SIGNOZ_DEFAULT_SERVICE_NAME?.trim() || "payments-svc",
        },
        annotations: {
          summary: "p99 latency above 800ms for payments-svc",
          info: "SigNoz detected P99 latency degradation in the incident window.",
        },
        startsAt,
        fingerprint: `seed-${startsAt.slice(0, 13)}`,
      },
    ],
    commonLabels: {
      severity: "critical",
    },
  };
}

async function waitForPipeline(investigationId: string, timeoutMs = 90_000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const [row] = await db
      .select({ status: investigationsTable.status })
      .from(investigationsTable)
      .where(eq(investigationsTable.id, investigationId))
      .limit(1);

    if (row?.status === "ready" || row?.status === "failed") {
      return row.status;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return "timeout";
}

async function main() {
  const service = new InvestigationService();
  const payload = buildSampleAlertPayload();

  console.log("[investigation-seed] Firing sample SigNoz alert webhook…");
  const { investigationIds } = await service.handleSignozWebhook(payload);

  if (investigationIds.length === 0) {
    console.error("[investigation-seed] No investigation created. Check INVESTIGATION_OWNER_EMAIL.");
    process.exit(1);
  }

  const id = investigationIds[0]!;
  console.log(`[investigation-seed] Created investigation ${id}. Waiting for pipeline…`);

  const status = await waitForPipeline(id);
  console.log(`[investigation-seed] Pipeline finished with status: ${status}`);
  console.log(`[investigation-seed] Open http://localhost:3000/investigations and select the new case.`);
}

main().catch((err) => {
  console.error("[investigation-seed] Failed:", err);
  process.exit(1);
});
