import type { SelectTelemetrySamplingPolicy } from "@repo/database/schema";

import type { SamplingPolicyDecision } from "../types";

export function mapSamplingPolicyRow(row: SelectTelemetrySamplingPolicy): SamplingPolicyDecision {
  return {
    serviceName: row.serviceName,
    mode: row.mode,
    sampleRate: row.sampleRate,
    reason: row.reason,
    triggerSource: row.triggerSource,
    expiresAt: row.expiresAt,
    metadata: row.metadata ?? {},
  };
}

export function mapSamplingPolicyRows(rows: SelectTelemetrySamplingPolicy[]): SamplingPolicyDecision[] {
  return rows.map(mapSamplingPolicyRow);
}
