import { pingDatabase } from "@repo/database/health";

import { isOpenAiConfigured } from "../ai/openai";
import { isGithubApiConfigured } from "../github/api";
import { signozClient } from "../signoz/client";
import { isDatabaseConfigured } from "./config";

export async function probeDatabaseConnection(): Promise<{ ok: boolean; message: string }> {
  if (!isDatabaseConfigured()) {
    return { ok: false, message: "DATABASE_URL is not set" };
  }

  try {
    await pingDatabase();
    return { ok: true, message: "Database connected" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Database ping failed",
    };
  }
}

export async function probeGithubApiConnection(): Promise<{ ok: boolean; message: string }> {
  if (!isGithubApiConfigured()) {
    return { ok: false, message: "GITHUB_TOKEN is not set" };
  }

  const token = process.env.GITHUB_TOKEN?.trim();
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "Evolvex-Investigation-OS",
      },
    });

    if (!response.ok) {
      return { ok: false, message: `GitHub API returned ${response.status}` };
    }

    const json = (await response.json()) as { login?: string };
    return { ok: true, message: json.login ? `GitHub connected as @${json.login}` : "GitHub API connected" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "GitHub API request failed",
    };
  }
}

export async function probeOpenAiConnection(): Promise<{ ok: boolean; message: string }> {
  if (!isOpenAiConfigured()) {
    return { ok: false, message: "OPENAI_API_KEY is not set" };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      return { ok: false, message: `OpenAI API returned ${response.status}` };
    }

    return { ok: true, message: "OpenAI API connected" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "OpenAI API request failed",
    };
  }
}

export function probeSignozConnection() {
  return signozClient.testConnection();
}
