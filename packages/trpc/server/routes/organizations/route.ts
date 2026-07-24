import { z } from "zod";

import { listUserOrganizations } from "@repo/services/organization";

import { protectedProcedure, router } from "../trpc";

const TAGS = ["Organizations"];

const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  role: z.enum(["owner", "member"]),
});

export const organizationsRouter = router({
  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/organizations", tags: TAGS } })
    .input(z.object({}).optional())
    .output(z.array(organizationSchema))
    .query(async ({ ctx }) => {
      return listUserOrganizations(ctx.user.id);
    }),
});
