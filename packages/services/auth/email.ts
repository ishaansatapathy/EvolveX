import { logger } from "@repo/logger";

import { env, isEmailConfigured } from "../env";

type SendEmailInput = {
  email: string;
  subject: string;
  html: string;
  text: string;
};

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

function isProduction() {
  const nodeEnv = String(env.NODE_ENV ?? "");
  return nodeEnv === "production" || nodeEnv === "prod";
}

function isBrevoApiKey(key: string) {
  // Brevo API keys start with xkeysib-
  return key.startsWith("xkeysib-");
}

function parseSenderAddress(from: string) {
  const trimmed = from.trim();
  const bracketMatch = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (bracketMatch) {
    return { name: bracketMatch[1]!.trim(), email: bracketMatch[2]!.trim() };
  }
  return {
    name: env.EMAIL_SENDER_NAME?.trim() || "Evolvex",
    email: trimmed,
  };
}

async function sendViaBrevo(input: SendEmailInput) {
  const apiKey = env.BREVO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Email delivery is not configured. Please contact support.");
  }
  if (!isBrevoApiKey(apiKey)) {
    logger.error("Brevo API key format is invalid", { prefix: apiKey.slice(0, 10) });
    throw new Error("Email delivery is misconfigured. Please contact support.");
  }

  const sender = parseSenderAddress(env.EMAIL_FROM!);
  const response = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender,
      to: [{ email: input.email.trim() }],
      subject: input.subject,
      htmlContent: input.html,
      textContent: input.text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    logger.error("Brevo email failed", { status: response.status, detail, to: input.email });
    throw new Error("Failed to send email. Please try again later.");
  }

  logger.info("Email sent via Brevo", { to: input.email, subject: input.subject });
}

/** Sends to any recipient address ? no per-user allowlist. */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (!isEmailConfigured()) {
    if (isProduction()) {
      logger.error("Email provider is not configured in production", {
        to: input.email,
        subject: input.subject,
      });
      throw new Error("Email delivery is not configured. Please contact support.");
    }

    logger.warn("DEV EMAIL ? set BREVO_API_KEY + EMAIL_FROM to send real mail", {
      to: input.email,
      subject: input.subject,
      text: input.text,
    });
    return;
  }

  await sendViaBrevo(input);
}

export function isDevEmailLogging(): boolean {
  return !isEmailConfigured() && !isProduction();
}
