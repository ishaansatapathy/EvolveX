import type { SelectInvestigation } from "@repo/database/schema";
import type { SignozAlert, SignozWebhookPayload } from "../signoz/types";
import { TelemetryIntelligenceOrchestrator } from "./orchestrator";
import type { TelemetryIntelligenceSnapshot } from "./types";
import { attachTelemetryIntelligenceSnapshot } from "./vectors/telemetry-vectors";

type StoredSignozPayload = {
  payload?: SignozWebhookPayload;
  alert?: SignozAlert;
};

function parseStoredSignozPayload(row: SelectInvestigation) {
  const stored = row.signozAlertPayload as StoredSignozPayload | null;
  if (!stored?.alert || !stored?.payload) return null;
  return { alert: stored.alert, payload: stored.payload };
}

/** Lazy-build and persist telemetry intelligence for investigations missing a snapshot. */
export async function ensureTelemetryIntelligenceForInvestigation(
  row: SelectInvestigation,
): Promise<TelemetryIntelligenceSnapshot | null> {
  const existing = row.telemetryIntelligence as TelemetryIntelligenceSnapshot | null;
  if (existing?.processedAt) return existing;

  const signoz = parseStoredSignozPayload(row);
  if (!signoz) return null;

  const orchestrator = new TelemetryIntelligenceOrchestrator(async () => ({ investigationIds: [] }));
  const snapshot = await orchestrator.processAlert({
    alert: signoz.alert,
    payload: signoz.payload,
    organizationId: row.organizationId,
  });

  await attachTelemetryIntelligenceSnapshot(row.id, snapshot);
  return snapshot;
}
