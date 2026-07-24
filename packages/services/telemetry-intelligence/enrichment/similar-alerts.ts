import { and, desc, eq, gte, ilike, or } from "@repo/database";
import { db } from "@repo/database";
import { changeEventsTable, investigationsTable } from "@repo/database/schema";

import { classifySignozAlert } from "../../signoz/alert-classifier";
import type { SignozAlert, SignozWebhookPayload } from "../../signoz/types";
import { extractServiceNames, shortInvestigationId } from "../../signoz/webhook-parser";
import type { AlertEnrichmentSnapshot, SimilarAlertMatch } from "../types";

/** Find prior investigations with matching alert name or service. */
export async function findSimilarAlerts(input: {
  alert: SignozAlert;
  payload: SignozWebhookPayload;
  organizationId: string | null;
  limit?: number;
}): Promise<SimilarAlertMatch[]> {
  const alertName = input.alert.labels.alertname?.trim();
  const services = extractServiceNames(input.alert, input.payload);
  const primaryService = services[0];
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const limit = input.limit ?? 5;

  const clauses = [gte(investigationsTable.createdAt, since)];

  if (input.organizationId) {
    clauses.push(eq(investigationsTable.organizationId, input.organizationId));
  }

  const matchClauses = [];
  if (alertName) {
    matchClauses.push(eq(investigationsTable.alertName, alertName));
    matchClauses.push(ilike(investigationsTable.title, `%${alertName}%`));
  }
  if (primaryService) {
    matchClauses.push(eq(investigationsTable.primaryService, primaryService));
  }

  if (matchClauses.length === 0) return [];

  const rows = await db
    .select()
    .from(investigationsTable)
    .where(and(...clauses, or(...matchClauses)))
    .orderBy(desc(investigationsTable.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    investigationId: row.id,
    shortId: row.incidentId ?? shortInvestigationId(row.id),
    title: row.title,
    alertName: row.alertName,
    primaryService: row.primaryService,
    createdAt: row.createdAt.toISOString(),
    matchReason:
      row.alertName === alertName
        ? "Same alert name"
        : row.primaryService === primaryService
          ? "Same primary service"
          : "Title similarity",
  }));
}

async function countRecentDeploys(serviceName: string) {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: changeEventsTable.id })
    .from(changeEventsTable)
    .where(
      and(
        gte(changeEventsTable.occurredAt, since),
        ilike(changeEventsTable.service, `%${serviceName}%`),
      ),
    )
    .limit(20);

  return rows.length;
}

/** Feature #3 — pre-investigation alert enrichment snapshot. */
export async function buildAlertEnrichment(input: {
  alert: SignozAlert;
  payload: SignozWebhookPayload;
  organizationId: string | null;
}): Promise<AlertEnrichmentSnapshot> {
  const serviceNames = extractServiceNames(input.alert, input.payload);
  const classification = classifySignozAlert(input.alert);
  const severity = input.alert.labels.severity ?? input.payload.commonLabels?.severity ?? null;
  const similarAlerts = await findSimilarAlerts({
    alert: input.alert,
    payload: input.payload,
    organizationId: input.organizationId,
  });

  const primaryService = serviceNames[0];
  const recentDeployCount = primaryService ? await countRecentDeploys(primaryService) : 0;

  const enrichmentNotes: string[] = [];
  if (similarAlerts.length > 0) {
    enrichmentNotes.push(`${similarAlerts.length} similar prior alert(s) in last 90 days.`);
  }
  if (recentDeployCount > 0) {
    enrichmentNotes.push(`${recentDeployCount} deploy/change event(s) in last 6 hours.`);
  }
  if (classification.kind === "latency_percentile") {
    enrichmentNotes.push(`Classified as ${classification.percentile ?? "tail"} latency alert.`);
  }

  return {
    alertName: input.alert.labels.alertname ?? "unknown",
    serviceNames,
    classification,
    severity,
    similarAlerts,
    recentDeployCount,
    baselineHealthy: recentDeployCount === 0,
    enrichmentNotes,
  };
}
