import { z } from "zod";
import { and, eq } from "@repo/database";
import db from "@repo/database";
import { briefDismissalsTable, briefCacheTable } from "@repo/database/schema";

import { dailyBriefSchema, generateDailyBrief, isInboxAiConfigured, analyzeInboxThreads } from "@repo/services/ai";

// ── DB-backed daily brief cache ───────────────────────────────────────────────
// Persists across Railway restarts. One row per user per calendar day.
// Falls back to in-memory 5-min cache on DB errors so the route stays live.

const memBriefCache = new Map<string, { data: z.infer<typeof dailyBriefSchema>; expiresAt: number }>();

function todayDateKey(timeZone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timeZone || "UTC" });
}

async function getDbCachedBrief(
  userId: string,
  timeZone: string,
): Promise<z.infer<typeof dailyBriefSchema> | null> {
  try {
    const dateKey = todayDateKey(timeZone);
    const rows = await db
      .select()
      .from(briefCacheTable)
      .where(and(eq(briefCacheTable.userId, userId), eq(briefCacheTable.dateKey, dateKey)))
      .limit(1);
    if (!rows[0]) return null;
    return dailyBriefSchema.parse(JSON.parse(rows[0].briefJson));
  } catch {
    // DB miss or parse error — regenerate
    return null;
  }
}

async function setDbCachedBrief(
  userId: string,
  timeZone: string,
  data: z.infer<typeof dailyBriefSchema>,
): Promise<void> {
  try {
    const dateKey = todayDateKey(timeZone);
    await db
      .insert(briefCacheTable)
      .values({ userId, dateKey, briefJson: JSON.stringify(data) })
      .onConflictDoUpdate({
        target: [briefCacheTable.userId, briefCacheTable.dateKey],
        set: { briefJson: JSON.stringify(data), generatedAt: new Date() },
      });
  } catch {
    // Non-fatal — client still gets the brief
  }
}

/** In-memory fallback for when DB is unavailable (5 min TTL). */
function getMemCached(userId: string): z.infer<typeof dailyBriefSchema> | null {
  const entry = memBriefCache.get(userId);
  if (!entry || entry.expiresAt <= Date.now()) { memBriefCache.delete(userId); return null; }
  return entry.data;
}
function setMemCached(userId: string, data: z.infer<typeof dailyBriefSchema>) {
  memBriefCache.set(userId, { data, expiresAt: Date.now() + 5 * 60 * 1000 });
  if (memBriefCache.size > 500) { const k = memBriefCache.keys().next().value; if (k) memBriefCache.delete(k); }
}

export async function invalidateBriefCache(tenantId: string, timeZone = "UTC") {
  memBriefCache.delete(tenantId);
  try {
    const dateKey = todayDateKey(timeZone);
    await db
      .delete(briefCacheTable)
      .where(and(eq(briefCacheTable.userId, tenantId), eq(briefCacheTable.dateKey, dateKey)));
  } catch { /* non-fatal */ }
}
import { getMeetingPrep } from "@repo/services/ai/meeting-prep";
import { getThreadContext } from "@repo/services/ai/thread-context";
import { getMissedFollowUps } from "@repo/services/ai/missed-followups";
import { getSmartReplies } from "@repo/services/ai/smart-reply";
import { getContactIntel } from "@repo/services/ai/contact-intel";
import { summarizeThread } from "@repo/services/ai/summarize-thread";
import { getInboxService } from "@repo/services/inbox";
import { findMeetingSlots } from "@repo/services/ai/meeting-slots";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["AI"];
const getPath = generatePath("/ai");

const inboxRankThreadSchema = z.object({
  id: z.string().min(1),
  snippet: z.string(),
  subject: z.string().max(998).optional(),
  from: z.string().max(320).optional(),
});

const inboxRankItemSchema = z.object({
  id: z.string(),
  urgency: z.enum(["critical", "high", "medium", "low", "noise"]),
  score: z.number(),
  reason: z.string(),
  category: z.enum(["reply_needed", "deadline", "meeting", "billing", "fyi", "promo"]),
});

const inboxAnalysisSchema = z.object({
  rankedIds: z.array(z.string()),
  items: z.array(inboxRankItemSchema),
  summary: z.object({
    total: z.number(),
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
    noise: z.number(),
    replyNeeded: z.number(),
    analyzedAt: z.string(),
  }),
});

const contactIntelSchema = z.object({
  email: z.string(),
  name: z.string().optional(),
  totalInteractions: z.number(),
  lastInteractionDaysAgo: z.number().nullable(),
  lastInteractionDate: z.string().optional(),
  sentByUser: z.number(),
  receivedFromContact: z.number(),
  responseRate: z.number().nullable(),
  recentTopics: z.array(z.string()),
  relationshipSummary: z.string(),
  recommendedAction: z.string(),
  recentThreads: z.array(
    z.object({
      id: z.string(),
      subject: z.string(),
      date: z.string().optional(),
      direction: z.enum(["sent", "received"]),
    }),
  ),
});

const summarizeThreadSchema = z.object({
  threadId: z.string(),
  subject: z.string(),
  participantCount: z.number(),
  messageCount: z.number(),
  summary: z.string(),
  keyDecisions: z.array(z.string()),
  actionItems: z.array(
    z.object({
      action: z.string(),
      owner: z.string().optional(),
      deadline: z.string().optional(),
    }),
  ),
  nextStep: z.string(),
  sentiment: z.enum(["positive", "neutral", "urgent", "negative"]),
});

export const aiRouter = router({
  status: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/status"), tags: TAGS } })
    .input(z.object({}))
    .output(
      z.object({
        openai: z.boolean(),
        model: z.string().optional(),
      }),
    )
    .query(async () => {
      return {
        openai: isInboxAiConfigured(),
        model: isInboxAiConfigured() ? process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini" : undefined,
      };
    }),

  rankInboxThreads: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/inbox/rank"), tags: TAGS } })
    .input(
      z.object({
        threads: z.array(inboxRankThreadSchema).min(1).max(50),
        /** When true, auto-apply Gmail labels (Corsair/Critical, Corsair/High Priority, etc.) via Corsair. */
        autoLabel: z.boolean().optional(),
      }),
    )
    .output(inboxAnalysisSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const analysis = await analyzeInboxThreads(input.threads);
        // Fire-and-forget auto-labeling — persists AI priority to Gmail labels via Corsair.
        if (input.autoLabel !== false) {
          const labelItems = analysis.items.filter(
            (i) => i.urgency === "critical" || i.urgency === "high" || i.category === "reply_needed" || i.category === "deadline",
          );
          if (labelItems.length > 0) {
            getInboxService()
              .autoLabelThreads(ctx.user.id, labelItems)
              .catch(() => { /* non-fatal */ });
          }
        }
        return analysis;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Smart Context Panel — why this email matters, related threads/events, follow-up. */
  threadContext: protectedProcedure
    .input(z.object({ threadId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return await getThreadContext({
          tenantId: ctx.user.id,
          threadId: input.threadId,
          userEmail: ctx.user.email,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Meeting Prep AI — agenda, talking points, risks, related emails. */
  meetingPrep: protectedProcedure
    .input(z.object({ eventId: z.string().min(1), timeZone: z.string().max(64).optional() }))
    .query(async ({ ctx, input }) => {
      try {
        return await getMeetingPrep({
          tenantId: ctx.user.id,
          eventId: input.eventId,
          timeZone: input.timeZone,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Missed follow-ups — meetings with no follow-up email sent. */
  missedFollowUps: protectedProcedure
    .input(z.object({ timeZone: z.string().max(64).optional() }))
    .query(async ({ ctx, input }) => {
      try {
        return await getMissedFollowUps({
          tenantId: ctx.user.id,
          userEmail: ctx.user.email,
          timeZone: input.timeZone,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Smart Reply — 3 AI-generated reply suggestions for an open thread. */
  smartReplies: protectedProcedure
    .input(z.object({ threadId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return await getSmartReplies({
          tenantId: ctx.user.id,
          threadId: input.threadId,
          userEmail: ctx.user.email,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Contact intelligence — relationship summary for an email contact via Corsair Gmail + OpenAI. */
  contactIntel: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/contact-intel"), tags: TAGS } })
    .input(z.object({ email: z.string().email(), name: z.string().optional() }))
    .output(contactIntelSchema)
    .query(async ({ ctx, input }) => {
      try {
        return await getContactIntel({
          tenantId: ctx.user.id,
          email: input.email,
          name: input.name,
          userEmail: ctx.user.email,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Thread summary — key decisions, action items, and next steps via Corsair Gmail + OpenAI. */
  summarizeThread: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/summarize-thread"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(summarizeThreadSchema)
    .query(async ({ ctx, input }) => {
      try {
        return await summarizeThread({
          tenantId: ctx.user.id,
          threadId: input.threadId,
          userEmail: ctx.user.email,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Find available meeting slots using Corsair Calendar free/busy + optional AI ranking. */
  findMeetingSlots: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/meeting-slots"), tags: TAGS } })
    .input(
      z.object({
        durationMinutes: z.number().int().min(15).max(480),
        preferredStartDate: z.string().optional(),
        preferredEndDate: z.string().optional(),
        timeZone: z.string().max(64).optional(),
        attendeeEmail: z.string().email().optional(),
        context: z.string().max(200).optional(),
      }),
    )
    .output(
      z.object({
        slots: z.array(
          z.object({
            startIso: z.string(),
            endIso: z.string(),
            label: z.string(),
          }),
        ),
        note: z.string().optional(),
        calendarConnected: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await findMeetingSlots({
          tenantId: ctx.user.id,
          ...input,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Daily brief — cached per-user per day in DB (falls back to 5-min memory cache). */
  dailyBrief: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/daily-brief"), tags: TAGS } })
    .input(
      z.object({
        timeZone: z.string().max(64).optional(),
        /** Pass true to bypass cache and force a fresh brief from Corsair + OpenAI. */
        refresh: z.boolean().optional(),
      }),
    )
    .output(dailyBriefSchema)
    .query(async ({ ctx, input }) => {
      const timeZone = input.timeZone?.trim() || "UTC";
      try {
        if (!input.refresh) {
          const dbCached = await getDbCachedBrief(ctx.user.id, timeZone);
          if (dbCached) return dbCached;
          const memCached = getMemCached(ctx.user.id);
          if (memCached) return memCached;
        }
        // Fetch user's dismissed thread IDs so the brief generator can filter them out.
        const dismissedRows = await db
          .select({ threadId: briefDismissalsTable.threadId })
          .from(briefDismissalsTable)
          .where(eq(briefDismissalsTable.userId, ctx.user.id))
          .catch(() => [] as Array<{ threadId: string }>);
        const dismissedThreadIds = dismissedRows.map((r) => r.threadId);

        const brief = await generateDailyBrief({
          tenantId: ctx.user.id,
          userEmail: ctx.user.email,
          displayName: ctx.user.displayName ?? ctx.user.fullName,
          timeZone,
          dismissedThreadIds,
        });
        // Persist to DB (daily) + memory (5 min fallback) — fire-and-forget.
        setDbCachedBrief(ctx.user.id, timeZone, brief).catch(() => {});
        setMemCached(ctx.user.id, brief);
        return brief;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Return all thread IDs the user has dismissed from their daily brief (server-persisted). */
  getBriefDismissals: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/brief-dismissals"), tags: TAGS } })
    .input(z.object({}))
    .output(z.object({ dismissedThreadIds: z.array(z.string()) }))
    .query(async ({ ctx }) => {
      try {
        const rows = await db
          .select({ threadId: briefDismissalsTable.threadId })
          .from(briefDismissalsTable)
          .where(eq(briefDismissalsTable.userId, ctx.user.id));
        return { dismissedThreadIds: rows.map((r) => r.threadId) };
      } catch (error) {
        // Graceful fallback — UI falls back to localStorage if DB is unavailable.
        mapServiceError(error);
      }
    }),

  /** Dismiss a thread from the daily brief — persisted to DB per user. */
  dismissBriefThread: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/brief-dismissals"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await db
          .insert(briefDismissalsTable)
          .values({ userId: ctx.user.id, threadId: input.threadId })
          .onConflictDoNothing();
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Un-dismiss a thread from the daily brief (e.g. user wants to see it again). */
  undismissBriefThread: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: getPath("/brief-dismissals"), tags: TAGS } })
    .input(z.object({ threadId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await db
          .delete(briefDismissalsTable)
          .where(
            and(
              eq(briefDismissalsTable.userId, ctx.user.id),
              eq(briefDismissalsTable.threadId, input.threadId),
            ),
          );
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
