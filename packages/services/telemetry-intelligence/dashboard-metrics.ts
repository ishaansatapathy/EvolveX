import { and, count, desc, eq, gte, isNotNull, sql } from "@repo/database";
import { db } from "@repo/database";
import { investigationsTable } from "@repo/database/schema";

import { listActiveSamplingPolicies } from "./sampling/policy-store";
import { getTelemetryIntelligenceConfig } from "./config";

export type IncidentProneService = {
  service: string;
  incidentCount: number;
  lastIncidentAt: string;
  openCount: number;
};

export type TopAlertCategory = {
  alertName: string;
  count: number;
  primaryService: string | null;
};

export type RecentInvestigationRow = {
  id: string;
  shortId: string;
  title: string;
  primaryService: string | null;
  severity: string | null;
  caseStatus: string;
  createdAt: string;
};

export type TelemetryIntelligenceDashboard = {
  windowDays: number;
  generatedAt: string;
  intelligenceState: "normal" | "elevated" | "incident" | "change_boost";
  totals: {
    investigations: number;
    open: number;
    resolved: number;
    failed: number;
  };
  avgInvestigationMinutes: number | null;
  resolutionRatePercent: number;
  activeSamplingPolicies: number;
  incidentProneServices: IncidentProneService[];
  topAlertCategories: TopAlertCategory[];
  frequentRootCauseSignals: Array<{ signal: string; count: number }>;
  recentInvestigations: RecentInvestigationRow[];
};

function shortId(id: string) {
  return `INV-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function orgFilter(organizationId?: string | null) {
  return organizationId ? eq(investigationsTable.organizationId, organizationId) : undefined;
}

/** Feature #55 — investigation intelligence dashboard from real Postgres data. */
export async function buildTelemetryIntelligenceDashboard(input?: {
  organizationId?: string | null;
  windowDays?: number;
}): Promise<TelemetryIntelligenceDashboard> {
  const windowDays = input?.windowDays ?? 30;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const orgClause = orgFilter(input?.organizationId);
  const windowClause = gte(investigationsTable.createdAt, since);
  const whereClause = orgClause ? and(orgClause, windowClause) : windowClause;

  const [totalsRow] = await db
    .select({
      total: count(),
      open: sql<number>`count(*) filter (where ${investigationsTable.caseStatus} in ('open', 'investigating', 'monitoring'))`,
      resolved: sql<number>`count(*) filter (where ${investigationsTable.caseStatus} = 'resolved')`,
      failed: sql<number>`count(*) filter (where ${investigationsTable.status} = 'failed')`,
    })
    .from(investigationsTable)
    .where(whereClause);

  const avgRow = await db
    .select({
      avgMs: sql<number | null>`avg(extract(epoch from (${investigationsTable.completedAt} - ${investigationsTable.startedAt})) * 1000)`,
    })
    .from(investigationsTable)
    .where(
      and(
        whereClause,
        isNotNull(investigationsTable.completedAt),
        isNotNull(investigationsTable.startedAt),
      ),
    );

  const serviceRows = await db
    .select({
      service: investigationsTable.primaryService,
      incidentCount: count(),
      openCount: sql<number>`count(*) filter (where ${investigationsTable.caseStatus} != 'resolved')`,
      lastIncidentAt: sql<Date>`max(${investigationsTable.createdAt})`,
    })
    .from(investigationsTable)
    .where(and(whereClause, isNotNull(investigationsTable.primaryService)))
    .groupBy(investigationsTable.primaryService)
    .orderBy(desc(count()))
    .limit(8);

  const alertRows = await db
    .select({
      alertName: investigationsTable.alertName,
      primaryService: investigationsTable.primaryService,
      count: count(),
    })
    .from(investigationsTable)
    .where(and(whereClause, isNotNull(investigationsTable.alertName)))
    .groupBy(investigationsTable.alertName, investigationsTable.primaryService)
    .orderBy(desc(count()))
    .limit(8);

  const recentRows = await db
    .select()
    .from(investigationsTable)
    .where(whereClause)
    .orderBy(desc(investigationsTable.createdAt))
    .limit(6);

  const titleRows = await db
    .select({
      title: investigationsTable.title,
      count: count(),
    })
    .from(investigationsTable)
    .where(whereClause)
    .groupBy(investigationsTable.title)
    .orderBy(desc(count()))
    .limit(5);

  const policies = await listActiveSamplingPolicies({ organizationId: input?.organizationId ?? null });
  const intelligenceState = policies.some((row) => row.mode === "incident")
    ? "incident"
    : policies.some((row) => row.mode === "change_boost")
      ? "change_boost"
      : policies.some((row) => row.mode === "elevated")
        ? "elevated"
        : "normal";

  const total = Number(totalsRow?.total ?? 0);
  const resolved = Number(totalsRow?.resolved ?? 0);
  const avgMs = avgRow[0]?.avgMs != null ? Number(avgRow[0].avgMs) : null;

  void getTelemetryIntelligenceConfig();

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    intelligenceState,
    totals: {
      investigations: total,
      open: Number(totalsRow?.open ?? 0),
      resolved,
      failed: Number(totalsRow?.failed ?? 0),
    },
    avgInvestigationMinutes: avgMs != null ? Math.round(avgMs / 60000) : null,
    resolutionRatePercent: total > 0 ? Math.round((resolved / total) * 100) : 0,
    activeSamplingPolicies: policies.length,
    incidentProneServices: serviceRows
      .filter((row) => row.service)
      .map((row) => ({
        service: row.service!,
        incidentCount: Number(row.incidentCount),
        openCount: Number(row.openCount),
        lastIncidentAt: row.lastIncidentAt.toISOString(),
      })),
    topAlertCategories: alertRows
      .filter((row) => row.alertName)
      .map((row) => ({
        alertName: row.alertName!,
        count: Number(row.count),
        primaryService: row.primaryService,
      })),
    frequentRootCauseSignals: titleRows.map((row) => ({
      signal: row.title,
      count: Number(row.count),
    })),
    recentInvestigations: recentRows.map((row) => ({
      id: row.id,
      shortId: row.incidentId ?? shortId(row.id),
      title: row.title,
      primaryService: row.primaryService,
      severity: row.severity,
      caseStatus: row.caseStatus,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
