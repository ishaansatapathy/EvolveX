import { and, desc, eq, gt, lt } from "@repo/database";
import { db } from "@repo/database";
import {
  telemetryIntelligenceEventsTable,
  telemetrySamplingPoliciesTable,
} from "@repo/database/schema";

import type { SamplingPolicyDecision } from "../types";

/** Remove expired sampling policies (production housekeeping). */
export async function cleanupExpiredSamplingPolicies() {
  const now = new Date();
  await db
    .delete(telemetrySamplingPoliciesTable)
    .where(lt(telemetrySamplingPoliciesTable.expiresAt, now));
}

async function findActivePolicyForService(input: {
  organizationId: string | null;
  serviceName: string;
}) {
  const now = new Date();
  const clauses = [
    eq(telemetrySamplingPoliciesTable.serviceName, input.serviceName),
    gt(telemetrySamplingPoliciesTable.expiresAt, now),
  ];

  if (input.organizationId) {
    clauses.push(eq(telemetrySamplingPoliciesTable.organizationId, input.organizationId));
  }

  const [row] = await db
    .select()
    .from(telemetrySamplingPoliciesTable)
    .where(and(...clauses))
    .orderBy(desc(telemetrySamplingPoliciesTable.createdAt))
    .limit(1);

  return row ?? null;
}

/** Persist active sampling policy (upsert per org+service) and emit TI audit event. */
export async function persistSamplingPolicy(input: {
  organizationId: string | null;
  investigationId?: string | null;
  policy: SamplingPolicyDecision;
}) {
  await cleanupExpiredSamplingPolicies();

  const existing = await findActivePolicyForService({
    organizationId: input.organizationId,
    serviceName: input.policy.serviceName,
  });

  if (existing) {
    await db
      .update(telemetrySamplingPoliciesTable)
      .set({
        mode: input.policy.mode,
        sampleRate: input.policy.sampleRate,
        reason: input.policy.reason,
        triggerSource: input.policy.triggerSource,
        investigationId: input.investigationId ?? null,
        expiresAt: input.policy.expiresAt,
        metadata: input.policy.metadata ?? {},
        updatedAt: new Date(),
      })
      .where(eq(telemetrySamplingPoliciesTable.id, existing.id));
  } else {
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
  }

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
      upserted: Boolean(existing),
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
