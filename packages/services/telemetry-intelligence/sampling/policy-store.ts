import { and, desc, eq, gt } from "@repo/database";
import { db } from "@repo/database";
import {
  telemetryIntelligenceEventsTable,
  telemetrySamplingPoliciesTable,
} from "@repo/database/schema";

import type { SamplingPolicyDecision } from "../types";

/** Persist active sampling policy and emit TI audit event. */
export async function persistSamplingPolicy(input: {
  organizationId: string | null;
  investigationId?: string | null;
  policy: SamplingPolicyDecision;
}) {
  await db.insert(telemetrySamplingPoliciesTable).values({
    organizationId: input.organizationId,
    serviceName: input.policy.serviceName,
    mode: input.policy.mode,
    sampleRate: input.policy.sampleRate,
    reason: input.policy.reason,
    triggerSource: input.policy.triggerSource,
    investigationId: input.investigationId ?? null,
    expiresAt: input.policy.expiresAt,
    metadata: input.policy.metadata ?? {},
  });

  await db.insert(telemetryIntelligenceEventsTable).values({
    organizationId: input.organizationId,
    kind: "sampling_policy_applied",
    serviceName: input.policy.serviceName,
    payload: {
      mode: input.policy.mode,
      sampleRate: input.policy.sampleRate,
      reason: input.policy.reason,
      triggerSource: input.policy.triggerSource,
      investigationId: input.investigationId ?? null,
    },
  });
}

export async function listActiveSamplingPolicies(input?: {
  organizationId?: string | null;
  serviceName?: string;
}) {
  const now = new Date();
  const clauses = [gt(telemetrySamplingPoliciesTable.expiresAt, now)];

  if (input?.organizationId) {
    clauses.push(eq(telemetrySamplingPoliciesTable.organizationId, input.organizationId));
  }
  if (input?.serviceName) {
    clauses.push(eq(telemetrySamplingPoliciesTable.serviceName, input.serviceName));
  }

  return db
    .select()
    .from(telemetrySamplingPoliciesTable)
    .where(and(...clauses))
    .orderBy(desc(telemetrySamplingPoliciesTable.createdAt))
    .limit(50);
}

export async function recordTelemetryIntelligenceEvent(input: {
  organizationId?: string | null;
  kind: string;
  serviceName?: string;
  payload?: Record<string, unknown>;
}) {
  await db.insert(telemetryIntelligenceEventsTable).values({
    organizationId: input.organizationId ?? null,
    kind: input.kind,
    serviceName: input.serviceName,
    payload: input.payload ?? {},
  });
}
