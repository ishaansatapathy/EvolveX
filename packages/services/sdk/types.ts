import { z } from "zod";

export const sdkTimelineEventSchema = z.object({
  title: z.string().min(1).max(255),
  detail: z.string().min(1).max(4000),
  kind: z.enum(["ALERT", "DEPLOY", "METRIC", "LOG", "TRACE", "CHANGE", "EBPF", "AI"]).default("CHANGE"),
  occurredAt: z.string().datetime().optional(),
  source: z.string().max(64).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sourceRef: z.record(z.string(), z.unknown()).optional(),
});

export const sdkCustomEventSchema = z.object({
  title: z.string().min(1).max(255),
  detail: z.string().min(1).max(4000),
  service: z.string().max(128).optional(),
  occurredAt: z.string().datetime().optional(),
  source: z.string().max(64).default("sdk"),
  metadata: z.record(z.string(), z.unknown()).optional(),
  investigationId: z.string().uuid().optional(),
});

export const sdkMetadataSchema = z.object({
  metadata: z.record(z.string(), z.unknown()),
  appendNote: z.string().max(500).optional(),
});

export type SdkTimelineEventInput = z.infer<typeof sdkTimelineEventSchema>;
export type SdkCustomEventInput = z.infer<typeof sdkCustomEventSchema>;
export type SdkMetadataInput = z.infer<typeof sdkMetadataSchema>;
