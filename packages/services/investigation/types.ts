import { z } from "zod";

export const investigationEvidenceSchema = z.object({
  id: z.string(),
  kind: z.enum(["ALERT", "TRACE", "LOG", "METRIC", "DEPLOY", "CHANGE", "EBPF"]),
  title: z.string(),
  detail: z.string(),
  occurredAt: z.string(),
  source: z.string().optional(),
});

export const investigationContextSchema = z.object({
  summary: z.string(),
  evidence: z.array(investigationEvidenceSchema),
  affectedServices: z.array(z.string()),
  incidentWindow: z.object({
    start: z.string(),
    end: z.string(),
  }),
  signozConfigured: z.boolean(),
  alertKind: z.enum(["latency_percentile", "error", "metric", "unknown"]).optional(),
  latencyPercentile: z.enum(["p50", "p90", "p95", "p99"]).nullable().optional(),
  notes: z.array(z.string()).default([]),
});

export const investigationListItemSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  title: z.string(),
  status: z.enum(["building", "ready", "failed"]),
  severity: z.string().nullable(),
  affectedServices: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export const timelineEntrySchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  kind: z.string(),
  title: z.string(),
  detail: z.string(),
  sourceRef: z.record(z.string(), z.unknown()).nullable(),
});

export const investigationDetailSchema = investigationListItemSchema.extend({
  alertName: z.string().nullable(),
  incidentWindowStart: z.string().nullable(),
  incidentWindowEnd: z.string().nullable(),
  context: investigationContextSchema.nullable(),
  errorMessage: z.string().nullable(),
});

export type InvestigationContext = z.infer<typeof investigationContextSchema>;
export type InvestigationListItem = z.infer<typeof investigationListItemSchema>;
export type InvestigationDetail = z.infer<typeof investigationDetailSchema>;
export type TimelineEntryDto = z.infer<typeof timelineEntrySchema>;
