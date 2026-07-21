import { z } from "zod";

export const signUpInputBaseSchema = z
  .object({
    fullName: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
    email: z.string().trim().email("Invalid email").max(255),
    password: z
      .string()
      .min(10, "Password must be at least 10 characters")
      .max(128)
      .regex(/[a-z]/, "Password must include a lowercase letter")
      .regex(/[A-Z]/, "Password must include an uppercase letter")
      .regex(/\d/, "Password must include a number"),
    confirmPassword: z.string(),
    turnstileToken: z.string().min(1).optional(),
  })
  .strict();

export const signUpInputSchema = signUpInputBaseSchema.refine(
  (input) => input.password === input.confirmPassword,
  { message: "Passwords do not match", path: ["confirmPassword"] },
);

export const signInInputSchema = z.object({
  email: z.string().trim().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
  turnstileToken: z.string().min(1).optional(),
});

export const forgotPasswordInputSchema = z.object({
  email: z.string().trim().email("Invalid email"),
  method: z.enum(["otp", "link"]).default("link"),
});

export const verifyOtpInputSchema = z.object({
  email: z.string().trim().email("Invalid email"),
  otp: z.string().length(6, "OTP must be 6 digits"),
});

export const resetPasswordInputBaseSchema = z
  .object({
    email: z.string().trim().email("Invalid email"),
    newPassword: z
      .string()
      .min(10, "Password must be at least 10 characters")
      .max(128)
      .regex(/[a-z]/, "Password must include a lowercase letter")
      .regex(/[A-Z]/, "Password must include an uppercase letter")
      .regex(/\d/, "Password must include a number"),
    otp: z.string().length(6).optional(),
    token: z.string().optional(),
  })
  .strict();

export const resetPasswordInputSchema = resetPasswordInputBaseSchema.refine(
  (input) => Boolean(input.otp || input.token),
  { message: "OTP or reset token is required", path: ["otp"] },
);

export const verify2FAInputSchema = z.object({
  email: z.string().trim().email("Invalid email"),
  otp: z.string().length(6, "OTP must be 6 digits"),
});

export const toggle2FAInputSchema = z.object({
  enabled: z.boolean(),
});

export const verifyEmailInputSchema = z.object({
  token: z.string().min(1),
});

export const sendVerificationEmailAgainInputSchema = z.object({
  email: z.string().trim().email("Invalid email"),
});

export const setupProfileInputSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Display name must be at least 2 characters")
    .max(40, "Display name must be at most 40 characters"),
});

export function assertSignUpPasswordsMatch(input: z.infer<typeof signUpInputSchema>) {
  if (input.password !== input.confirmPassword) {
    throw new Error("Passwords do not match");
  }
}

export function assertResetPasswordCredential(input: z.infer<typeof resetPasswordInputSchema>) {
  if (!input.otp && !input.token) {
    throw new Error("OTP or reset token is required");
  }
}

export type SignUpInput = z.infer<typeof signUpInputBaseSchema>;
export type SignInInput = z.infer<typeof signInInputSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpInputSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordInputBaseSchema>;
export type Verify2FAInput = z.infer<typeof verify2FAInputSchema>;
export type Toggle2FAInput = z.infer<typeof toggle2FAInputSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailInputSchema>;
export type SendVerificationEmailAgainInput = z.infer<typeof sendVerificationEmailAgainInputSchema>;
export type SetupProfileInput = z.infer<typeof setupProfileInputSchema>;
