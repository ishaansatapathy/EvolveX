import { z } from "zod";

export const dailyBriefActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(120),
  kind: z.enum(["reply", "prepare_meeting", "follow_up", "open_queue", "open_inbox", "agent"]),
  threadId: z.string().optional(),
  eventId: z.string().optional(),
  queueItemId: z.string().optional(),
  agentPrompt: z.string().max(2000).optional(),
});

export const dailyBriefItemSchema = z.object({
  headline: z.string().min(1).max(240),
  detail: z.string().max(500).optional(),
  urgency: z.enum(["high", "medium", "low"]).optional(),
  threadId: z.string().optional(),
  eventId: z.string().optional(),
  queueItemId: z.string().optional(),
});

export const dailyBriefFocusSchema = z.object({
  headline: z.string().min(1).max(240),
  detail: z.string().max(500).optional(),
  byTime: z.string().max(80).optional(),
  threadId: z.string().optional(),
  eventId: z.string().optional(),
});

export const dailyBriefFocusWindowSchema = z.object({
  label: z.string().min(1).max(160),
  startIso: z.string(),
  endIso: z.string(),
});

export const dailyBriefSchema = z.object({
  greeting: z.string().min(1).max(120),
  summary: z.string().min(1).max(320),
  todaysFocus: dailyBriefFocusSchema,
  needsAttention: z.array(dailyBriefItemSchema).max(8),
  meetingInsights: z.array(dailyBriefItemSchema).max(8),
  focusWindow: dailyBriefFocusWindowSchema.optional(),
  risks: z.array(dailyBriefItemSchema).max(6),
  recommendedActions: z.array(dailyBriefActionSchema).max(6),
  generatedAt: z.string(),
  connections: z.object({
    gmail: z.boolean(),
    calendar: z.boolean(),
  }),
});

export type DailyBrief = z.infer<typeof dailyBriefSchema>;
export type DailyBriefAction = z.infer<typeof dailyBriefActionSchema>;
export type DailyBriefItem = z.infer<typeof dailyBriefItemSchema>;

/** Model output before we attach metadata. */
export const dailyBriefModelSchema = z.object({
  greeting: z.string().min(1).max(120),
  summary: z.string().min(1).max(320),
  todaysFocus: dailyBriefFocusSchema,
  needsAttention: z.array(dailyBriefItemSchema).max(8),
  meetingInsights: z.array(dailyBriefItemSchema).max(8),
  focusWindow: dailyBriefFocusWindowSchema.optional(),
  risks: z.array(dailyBriefItemSchema).max(6),
  recommendedActions: z.array(dailyBriefActionSchema).max(6),
});

export type DailyBriefModel = z.infer<typeof dailyBriefModelSchema>;
