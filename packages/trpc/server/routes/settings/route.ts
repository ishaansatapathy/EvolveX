import { getSettingsService } from "@repo/services/settings";
import { z } from "zod";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Settings"];
const getPath = generatePath("/settings");

export const approvalDefaultsSchema = z.object({
  autoApproveEmail: z.boolean(),
  autoApproveAgentEmail: z.boolean(),
  autoApproveCalendar: z.boolean(),
});

export const settingsRouter = router({
  getApprovalDefaults: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/approval-defaults"), tags: TAGS } })
    .input(z.object({}))
    .output(approvalDefaultsSchema)
    .query(async ({ ctx }) => {
      try {
        const settings = getSettingsService();
        return await settings.getApprovalDefaults(ctx.user.id);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  updateApprovalDefaults: protectedProcedure
    .meta({ openapi: { method: "PUT", path: getPath("/approval-defaults"), tags: TAGS } })
    .input(approvalDefaultsSchema)
    .output(approvalDefaultsSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const settings = getSettingsService();
        return await settings.updateApprovalDefaults(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
