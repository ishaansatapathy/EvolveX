import { z } from "zod";

export const signozAlertSchema = z.object({
  status: z.string(),
  labels: z.record(z.string(), z.string()).default({}),
  annotations: z.record(z.string(), z.string()).default({}),
  startsAt: z.string(),
  endsAt: z.string().optional(),
  generatorURL: z.string().optional(),
  fingerprint: z.string().optional(),
});

export const signozWebhookPayloadSchema = z.object({
  receiver: z.string().optional(),
  status: z.enum(["firing", "resolved"]),
  alerts: z.array(signozAlertSchema).min(1),
  groupLabels: z.record(z.string(), z.string()).optional(),
  commonLabels: z.record(z.string(), z.string()).optional(),
  commonAnnotations: z.record(z.string(), z.string()).optional(),
  externalURL: z.string().optional(),
  version: z.string().optional(),
  groupKey: z.string().optional(),
  truncatedAlerts: z.number().optional(),
});

export type SignozWebhookPayload = z.infer<typeof signozWebhookPayloadSchema>;
export type SignozAlert = z.infer<typeof signozAlertSchema>;

export type SignozLogRow = {
  timestamp?: string;
  body?: string;
  severityText?: string;
  serviceName?: string;
  traceId?: string;
};

export type SignozTraceRow = {
  traceId?: string;
  spanId?: string;
  serviceName?: string;
  name?: string;
  durationMs?: number;
  hasError?: boolean;
  timestamp?: string;
};
