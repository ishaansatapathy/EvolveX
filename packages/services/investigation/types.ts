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
  caseStatus: z.enum(["open", "investigating", "monitoring", "resolved"]),
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
  source: z.string().nullable().optional(),
  sourceRef: z.record(z.string(), z.unknown()).nullable(),
  sortOrder: z.number().optional(),
});

export const evidenceRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string(),
  occurredAt: z.string(),
  url: z.string().nullable(),
  confidence: z.string().nullable(),
  timelineEntryId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

export const changeEventRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  service: z.string().nullable(),
  author: z.string().nullable(),
  occurredAt: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

export const runtimeSignalRowSchema = z.object({
  id: z.string(),
  traceId: z.string().nullable(),
  service: z.string().nullable(),
  metric: z.string().nullable(),
  latencyMs: z.number().nullable(),
  p95Ms: z.number().nullable(),
  p99Ms: z.number().nullable(),
  errorRate: z.string().nullable(),
  signalTimestamp: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

export const serviceNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  healthy: z.boolean(),
  latencyMs: z.number().nullable(),
});

export const dependencyEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  destination: z.string(),
  healthy: z.boolean(),
  latencyMs: z.number().nullable(),
});

export const investigationOsContextSchema = z.object({
  investigation: z.object({
    id: z.string(),
    incidentId: z.string().nullable(),
    status: z.enum(["building", "ready", "failed"]),
    caseStatus: z.enum(["open", "investigating", "monitoring", "resolved"]),
    severity: z.string().nullable(),
    primaryService: z.string().nullable(),
    summary: z.string().nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
  }),
  timeline: z.array(timelineEntrySchema),
  evidence: z.array(evidenceRowSchema),
  changeEvents: z.array(changeEventRowSchema),
  runtimeSignals: z.array(runtimeSignalRowSchema),
  dependencies: z.object({
    nodes: z.array(serviceNodeSchema),
    edges: z.array(dependencyEdgeSchema),
  }),
  llmSummary: z
    .object({
      markdown: z.string(),
      generatedAt: z.string(),
    })
    .nullable(),
  aiConfidence: z.object({
    level: z.enum(["high", "medium", "low"]),
    rationale: z.string(),
  }),
  ebpfEnrichment: z.object({
    recommended: z.boolean(),
    collected: z.boolean(),
    canTrigger: z.boolean(),
  }),
  evidenceCompleteness: z.object({
    completenessPercent: z.number(),
    canConclude: z.boolean(),
    summary: z.string(),
    missingForConclusion: z.array(z.string()),
    recommendedNextSteps: z.array(z.string()),
    sources: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        status: z.enum(["collected", "missing", "unavailable", "partial"]),
        configured: z.boolean(),
        detail: z.string(),
      }),
    ),
  }),
  structuredEvidence: z.object({
    sections: z.array(
      z.object({
        id: z.enum(["deployment", "traces", "logs", "metrics", "infrastructure"]),
        title: z.string(),
        empty: z.boolean(),
        fields: z.array(z.object({ label: z.string(), value: z.string() })),
        items: z.array(
          z.object({
            primary: z.string(),
            secondary: z.string().optional(),
            occurredAt: z.string(),
            timelineEntryId: z.string().optional(),
          }),
        ),
      }),
    ),
  }),
  evidenceCitations: z.object({
    citations: z.array(
      z.object({
        ref: z.string(),
        timelineEntryId: z.string().nullable(),
        evidenceId: z.string().nullable(),
        kind: z.string(),
        label: z.string(),
        occurredAt: z.string(),
      }),
    ),
  }),
  incidentNarrative: z.object({
    summary: z.string(),
    empty: z.boolean(),
    beats: z.array(
      z.object({
        occurredAt: z.string(),
        citationRef: z.string().nullable(),
        timelineEntryId: z.string(),
        kind: z.string(),
        sentence: z.string(),
      }),
    ),
  }),
  rootCauseHypotheses: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
      rationale: z.string(),
      citationRefs: z.array(z.string()),
      kind: z.enum(["primary", "alternative"]),
    }),
  ),
  blastRadius: z.object({
    summary: z.string(),
    primaryService: z.string().nullable(),
    totalAffected: z.number(),
    impacts: z.array(
      z.object({
        service: z.string(),
        direction: z.enum(["origin", "downstream", "upstream"]),
        impactScore: z.number(),
        healthy: z.boolean(),
        latencyMs: z.number().nullable(),
        evidenceCount: z.number(),
        reasons: z.array(z.string()),
      }),
    ),
  }),
  knowledgeGraph: z.object({
    summary: z.string(),
    nodes: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(["service", "alert", "timeline", "evidence", "change", "deploy"]),
        label: z.string(),
        occurredAt: z.string().optional(),
        citationRef: z.string().nullable().optional(),
      }),
    ),
    edges: z.array(
      z.object({
        id: z.string(),
        source: z.string(),
        target: z.string(),
        kind: z.enum(["depends_on", "observed_on", "deployed_to", "correlates_with", "caused_by"]),
      }),
    ),
  }),
});

export const investigationNoteSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export type InvestigationNoteDto = z.infer<typeof investigationNoteSchema>;

export const investigationDetailSchema = investigationListItemSchema.extend({
  incidentId: z.string().nullable().optional(),
  primaryService: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
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
export type EvidenceRowDto = z.infer<typeof evidenceRowSchema>;
export type ChangeEventRowDto = z.infer<typeof changeEventRowSchema>;
export type RuntimeSignalRowDto = z.infer<typeof runtimeSignalRowSchema>;
export type ServiceNodeDto = z.infer<typeof serviceNodeSchema>;
export type DependencyEdgeDto = z.infer<typeof dependencyEdgeSchema>;
export type InvestigationOsContext = z.infer<typeof investigationOsContextSchema>;
