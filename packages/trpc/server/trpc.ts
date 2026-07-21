import { initTRPC, TRPCError } from "@trpc/server";
import { OpenApiMeta } from "trpc-to-openapi";
import { AuthError } from "@repo/services/auth/errors";
import { ServiceError } from "@repo/services/errors";
import { logger } from "@repo/logger";
import { ZodError } from "zod";

import { createContext } from "./context";
import { sanitizeTrpcError } from "./error-handler";

export const tRPCContext = initTRPC
  .meta<OpenApiMeta>()
  .context<typeof createContext>()
  .create({
    errorFormatter({ shape, error, ctx }) {
      const zodError =
        error.cause instanceof ZodError ? error.cause.flatten().fieldErrors : null;
      return {
        ...shape,
        message: ctx?.requestId ? `[${ctx.requestId}] ${shape.message}` : shape.message,
        data: {
          ...shape.data,
          zodError,
          requestId: ctx?.requestId,
        },
      };
    },
  });

export const router = tRPCContext.router;

const observabilityMiddleware = tRPCContext.middleware(async ({ path, type, ctx, next }) => {
  const started = Date.now();
  try {
    const result = await next();
    logger.debug("tRPC procedure completed", {
      path,
      type,
      requestId: ctx.requestId,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (error) {
    logger.warn("tRPC procedure failed", {
      path,
      type,
      requestId: ctx.requestId,
      durationMs: Date.now() - started,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

const baseProcedure = tRPCContext.procedure.use(observabilityMiddleware);

export const publicProcedure = baseProcedure;

export const protectedProcedure = baseProcedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const verifiedProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.emailVerified) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Email verification required. Check your inbox for the verification link.",
    });
  }
  return next({ ctx });
});

export function mapAuthError(error: unknown): never {
  if (error instanceof TRPCError) throw error;

  if (error instanceof AuthError) {
    const codeMap = {
      BAD_REQUEST: "BAD_REQUEST",
      UNAUTHORIZED: "UNAUTHORIZED",
      FORBIDDEN: "FORBIDDEN",
      NOT_FOUND: "NOT_FOUND",
      CONFLICT: "CONFLICT",
      INTERNAL: "INTERNAL_SERVER_ERROR",
    } as const;

    throw new TRPCError({
      code: codeMap[error.code],
      message: error.message,
    });
  }

  sanitizeTrpcError(error);
}

const serviceErrorCodeMap = {
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PRECONDITION_FAILED: "PRECONDITION_FAILED",
  INTERNAL: "INTERNAL_SERVER_ERROR",
} as const;

export function mapServiceError(error: unknown): never {
  if (error instanceof TRPCError) throw error;

  if (error instanceof ServiceError) {
    throw new TRPCError({
      code: serviceErrorCodeMap[error.code],
      message: error.message,
    });
  }

  sanitizeTrpcError(error);
}
