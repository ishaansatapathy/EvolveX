import { z } from "zod";

import { listAuditEvents } from "@repo/services/audit/log";

import { adminProcedure, router } from "../../trpc";

const TAGS = ["Audit"];

const auditEventSchema = z.object({
  id: z.string().uuid(),
  actorUserId: z.string().uuid().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const auditRouter = router({
  list: adminProcedure
    .meta({ openapi: { method: "GET", path: "/audit", tags: TAGS } })
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).optional(),
          investigationId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .output(z.array(auditEventSchema))
    .query(async ({ input }) => {
      return listAuditEvents({
        limit: input?.limit,
        investigationId: input?.investigationId,
      });
    }),
});
