import { z } from "zod";

import { db, eq, and } from "@repo/database";
import { briefCacheTable } from "@repo/database/schema";
import { dailyBriefSchema, generateDailyBrief } from "@repo/services/ai";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Brief"];
const getPath = generatePath("/brief");

/** YYYY-MM-DD in any timezone — just needs to be consistent per user. */
function todayDateKey(timeZone?: string): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: timeZone?.trim() || "UTC",
  });
}

export const briefRouter = router({
  get: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/"), tags: TAGS } })
    .input(
      z.object({
        timeZone: z.string().max(64).optional(),
        /** Pass true to force a fresh brief, ignoring the daily cache. */
        forceRefresh: z.boolean().optional(),
      }),
    )
    .output(dailyBriefSchema)
    .query(async ({ ctx, input }) => {
      try {
        const dateKey = todayDateKey(input.timeZone);

        if (!input.forceRefresh) {
          const cached = await db
            .select()
            .from(briefCacheTable)
            .where(
              and(
                eq(briefCacheTable.userId, ctx.user.id),
                eq(briefCacheTable.dateKey, dateKey),
              ),
            )
            .limit(1);

          if (cached[0]) {
            try {
              return dailyBriefSchema.parse(JSON.parse(cached[0].briefJson));
            } catch {
              // cached JSON is stale/corrupt — fall through to regenerate
            }
          }
        }

        const brief = await generateDailyBrief({
          tenantId: ctx.user.id,
          userEmail: ctx.user.email,
          displayName: ctx.user.displayName ?? ctx.user.fullName,
          timeZone: input.timeZone,
        });

        // Upsert today's cache (fire-and-forget — don't block the response).
        db.insert(briefCacheTable)
          .values({
            userId: ctx.user.id,
            dateKey,
            briefJson: JSON.stringify(brief),
          })
          .onConflictDoUpdate({
            target: [briefCacheTable.userId, briefCacheTable.dateKey],
            set: {
              briefJson: JSON.stringify(brief),
              generatedAt: new Date(),
            },
          })
          .catch(() => {
            // Non-fatal — brief is still returned to client.
          });

        return brief;
      } catch (error) {
        mapServiceError(error);
      }
    }),

  refresh: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/refresh"), tags: TAGS } })
    .input(
      z.object({
        timeZone: z.string().max(64).optional(),
      }),
    )
    .output(dailyBriefSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const brief = await generateDailyBrief({
          tenantId: ctx.user.id,
          userEmail: ctx.user.email,
          displayName: ctx.user.displayName ?? ctx.user.fullName,
          timeZone: input.timeZone,
        });

        const dateKey = todayDateKey(input.timeZone);

        await db
          .insert(briefCacheTable)
          .values({
            userId: ctx.user.id,
            dateKey,
            briefJson: JSON.stringify(brief),
          })
          .onConflictDoUpdate({
            target: [briefCacheTable.userId, briefCacheTable.dateKey],
            set: {
              briefJson: JSON.stringify(brief),
              generatedAt: new Date(),
            },
          });

        return brief;
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
