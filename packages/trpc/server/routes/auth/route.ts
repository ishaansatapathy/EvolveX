import {
  authUserSchema,
  messageOutputSchema,
  signInOutputSchema,
  signUpOutputSchema,
} from "@repo/services/auth/model";
import {
  forgotPasswordInputSchema,
  resetPasswordInputBaseSchema,
  sendVerificationEmailAgainInputSchema,
  setupProfileInputSchema,
  signInInputSchema,
  signUpInputBaseSchema,
  toggle2FAInputSchema,
  verify2FAInputSchema,
  verifyEmailInputSchema,
  verifyOtpInputSchema,
} from "@repo/services/auth/dtos";
import { assertTurnstileToken, getClientIp } from "@repo/services/auth/turnstile";

import { TRPCError } from "@trpc/server";

import { z, zodUndefinedModel } from "../../schema";
import { userService, authService } from "../../services";
import { getAuthenticationMethodOutputSchema } from "@repo/services/user/model";
import { mapAuthError, protectedProcedure, publicProcedure, router, verifiedProcedure } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Authentication"];
const getPath = generatePath("/authentication");

export const authRouter = router({
  getSupportedAuthenticationProviders: publicProcedure
    .meta({ openapi: { method: "GET", path: getPath("/supported-providers"), tags: TAGS } })
    .input(zodUndefinedModel)
    .output(z.readonly(z.array(getAuthenticationMethodOutputSchema)))
    .query(async () => userService.getAuthenticationMethods()),

  signUp: publicProcedure
    .meta({ openapi: { method: "POST", path: getPath("/sign-up"), tags: TAGS } })
    .input(signUpInputBaseSchema)
    .output(signUpOutputSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        if (input.password !== input.confirmPassword) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Passwords do not match" });
        }
        await assertTurnstileToken(input.turnstileToken, getClientIp(ctx.req));
        const { turnstileToken, ...signUpInput } = input;
        void turnstileToken;
        return await authService.signUp(signUpInput);
      } catch (error) {
        mapAuthError(error);
      }
    }),

  signIn: publicProcedure
    .meta({ openapi: { method: "POST", path: getPath("/sign-in"), tags: TAGS } })
    .input(signInInputSchema)
    .output(signInOutputSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        await assertTurnstileToken(input.turnstileToken, getClientIp(ctx.req));
        const { turnstileToken, ...signInInput } = input;
        void turnstileToken;
        return await authService.signIn(signInInput, ctx.res);
      } catch (error) {
        mapAuthError(error);
      }
    }),

  verify2FA: publicProcedure
    .meta({ openapi: { method: "POST", path: getPath("/verify-2fa"), tags: TAGS } })
    .input(verify2FAInputSchema)
    .output(authUserSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        return await authService.verify2FA(input, ctx.res);
      } catch (error) {
        mapAuthError(error);
      }
    }),

  logout: publicProcedure
    .meta({ openapi: { method: "POST", path: getPath("/logout"), tags: TAGS } })
    .input(zodUndefinedModel)
    .output(messageOutputSchema)
    .mutation(({ ctx }) => authService.logout(ctx.req, ctx.res)),

  refresh: publicProcedure
    .meta({ openapi: { method: "POST", path: getPath("/refresh"), tags: TAGS } })
    .input(zodUndefinedModel)
    .output(authUserSchema)
    .mutation(async ({ ctx }) => {
      try {
        return await authService.refreshAccessToken(ctx.req, ctx.res);
      } catch (error) {
        mapAuthError(error);
      }
    }),

  me: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/me"), tags: TAGS, protect: true } })
    .input(zodUndefinedModel)
    .output(authUserSchema)
    .query(({ ctx }) => ctx.user),

  forgotPassword: publicProcedure
    .meta({ openapi: { method: "POST", path: getPath("/forgot-password"), tags: TAGS } })
    .input(forgotPasswordInputSchema)
    .output(messageOutputSchema)
    .mutation(async ({ input }) => {
      try {
        return await authService.forgotPassword(input);
      } catch (error) {
        mapAuthError(error);
      }
    }),

  verifyOtp: publicProcedure
    .meta({ openapi: { method: "POST", path: getPath("/verify-otp"), tags: TAGS } })
    .input(verifyOtpInputSchema)
    .output(messageOutputSchema)
    .mutation(async ({ input }) => {
      try {
        return await authService.verifyOtp(input);
      } catch (error) {
        mapAuthError(error);
      }
    }),

  resetPassword: publicProcedure
    .meta({ openapi: { method: "POST", path: getPath("/reset-password"), tags: TAGS } })
    .input(resetPasswordInputBaseSchema)
    .output(messageOutputSchema)
    .mutation(async ({ input }) => {
      try {
        if (!input.otp && !input.token) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "OTP or reset token is required" });
        }
        return await authService.resetPassword(input);
      } catch (error) {
        mapAuthError(error);
      }
    }),

  verifyEmail: publicProcedure
    .meta({ openapi: { method: "POST", path: getPath("/verify-email"), tags: TAGS } })
    .input(verifyEmailInputSchema)
    .output(authUserSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        return await authService.verifyEmail(input, ctx.res);
      } catch (error) {
        mapAuthError(error);
      }
    }),

  sendVerificationEmailAgain: publicProcedure
    .meta({ openapi: { method: "POST", path: getPath("/send-verification-email-again"), tags: TAGS } })
    .input(sendVerificationEmailAgainInputSchema)
    .output(messageOutputSchema)
    .mutation(async ({ input }) => {
      try {
        return await authService.sendVerificationEmailAgain(input);
      } catch (error) {
        mapAuthError(error);
      }
    }),

  sendVerificationAgain: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/send-verification-again"), tags: TAGS, protect: true } })
    .input(zodUndefinedModel)
    .output(messageOutputSchema)
    .mutation(async ({ ctx }) => {
      try {
        return await authService.sendVerificationAgain(ctx.user.id);
      } catch (error) {
        mapAuthError(error);
      }
    }),

  toggle2FA: verifiedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/toggle-2fa"), tags: TAGS, protect: true } })
    .input(toggle2FAInputSchema)
    .output(
      z.object({
        message: z.string(),
        twoFactorEnabled: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await authService.toggle2FA(ctx.user.id, input.enabled);
      } catch (error) {
        mapAuthError(error);
      }
    }),

  setupProfile: verifiedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/setup-profile"), tags: TAGS, protect: true } })
    .input(setupProfileInputSchema)
    .output(authUserSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        return await authService.setupProfile(ctx.user.id, input.displayName);
      } catch (error) {
        mapAuthError(error);
      }
    }),
});
