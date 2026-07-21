import { z } from "zod";

import { getContactsService } from "@repo/services/contacts";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Contacts"];
const getPath = generatePath("/contacts");

const contactSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().optional(),
  handle: z.string(),
  source: z.enum(["manual", "inbox", "sent", "agent"]),
  lastUsedAt: z.string().optional(),
});

export const contactsRouter = router({
  search: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/search"), tags: TAGS } })
    .input(
      z.object({
        query: z.string().trim().min(1).max(80),
        limit: z.number().int().min(1).max(20).optional(),
      }),
    )
    .output(z.object({ contacts: z.array(contactSchema) }))
    .query(async ({ ctx, input }) => {
      try {
        const contacts = getContactsService();
        const results = await contacts.search(ctx.user.id, input.query, input.limit);
        return { contacts: results };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  upsert: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/upsert"), tags: TAGS } })
    .input(
      z.object({
        email: z.string().trim().email().max(320),
        displayName: z.string().trim().max(120).optional(),
      }),
    )
    .output(contactSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const contacts = getContactsService();
        return await contacts.upsert(ctx.user.id, {
          email: input.email,
          displayName: input.displayName,
          source: "manual",
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  syncFromInbox: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/sync-inbox"), tags: TAGS } })
    .input(z.object({}))
    .output(z.object({ imported: z.number().int(), fromCache: z.number().int(), fromLive: z.number().int() }))
    .mutation(async ({ ctx }) => {
      try {
        const contacts = getContactsService();
        return await contacts.syncFromInbox(ctx.user.id);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  syncInboxBatch: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/sync-inbox-batch"), tags: TAGS } })
    .input(
      z.object({
        pageToken: z.string().optional(),
        pageSize: z.number().int().min(1).max(50).optional(),
      }),
    )
    .output(
      z.object({
        imported: z.number().int(),
        threadsScanned: z.number().int(),
        nextPageToken: z.string().optional(),
        done: z.boolean(),
        resultSizeEstimate: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const contacts = getContactsService();
        return await contacts.syncInboxBatch(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
