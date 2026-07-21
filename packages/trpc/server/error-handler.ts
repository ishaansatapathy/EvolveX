import { TRPCError } from "@trpc/server";
import { logger } from "@repo/logger";

export function sanitizeTrpcError(error: unknown): never {
  if (error instanceof TRPCError) throw error;

  logger.error("Unhandled tRPC error", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong. Please try again.",
  });
}
