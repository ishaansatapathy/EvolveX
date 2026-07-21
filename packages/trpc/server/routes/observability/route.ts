import { z } from "zod";
import { getSharedCounters } from "@repo/services/observability/counters";

import { protectedProcedure, router } from "../../trpc";

export const observabilityRouter = router({
  summary: protectedProcedure
    .input(z.object({}))
    .output(
      z.object({
        counters: z.record(z.string(), z.number().int()),
        inboxCacheHits: z.number().int(),
        mcpToolCalls: z.number().int(),
      }),
    )
    .query(async () => {
      const counters = getSharedCounters();
      const mcpToolCalls = Object.entries(counters)
        .filter(([key]) => key.startsWith("mcp.tool."))
        .reduce((sum, [, value]) => sum + value, 0);

      return {
        counters,
        inboxCacheHits: counters["inbox.cache_hit"] ?? 0,
        mcpToolCalls,
      };
    }),
});
