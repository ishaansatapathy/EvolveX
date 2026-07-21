import { z } from "zod";

/** Strip CRLF injection vectors from RFC822 header values. */
export function sanitizeEmailHeader(value: string): string {
  return value.replace(/[\r\n]/g, "").trim();
}

export function parseRecipientAddress(value: string): string {
  const sanitized = sanitizeEmailHeader(value);
  const bracket = sanitized.match(/<([^>]+)>/);
  return (bracket?.[1] ?? sanitized).trim();
}

export const singleRecipientSchema = z
  .string()
  .min(3)
  .max(320)
  .transform(sanitizeEmailHeader)
  .refine((value) => z.string().email().safeParse(parseRecipientAddress(value)).success, {
    message: "Invalid recipient email address",
  });

export const safeEmailSubjectSchema = z
  .string()
  .min(1)
  .max(998)
  .transform(sanitizeEmailHeader)
  .refine((value) => value.length > 0, { message: "Subject is required" });

export const emailBodySchema = z.string().min(1).max(100_000);
