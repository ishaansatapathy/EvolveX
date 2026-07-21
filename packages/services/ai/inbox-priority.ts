import { z } from "zod";

import { ServiceError } from "../errors";
import { createChatCompletion, isOpenAiConfigured } from "./openai";

export type InboxRankInput = {
  id: string;
  snippet: string;
  subject?: string;
  from?: string;
};

export type InboxUrgency = "critical" | "high" | "medium" | "low" | "noise";

export type InboxPriorityCategory =
  | "reply_needed"
  | "deadline"
  | "meeting"
  | "billing"
  | "fyi"
  | "promo";

export type InboxRankItem = {
  id: string;
  urgency: InboxUrgency;
  /** 0–100 — higher = needs attention sooner */
  score: number;
  /** One-line explanation a human can trust */
  reason: string;
  category: InboxPriorityCategory;
};

export type InboxAnalysisResult = {
  rankedIds: string[];
  items: InboxRankItem[];
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    noise: number;
    replyNeeded: number;
    analyzedAt: string;
  };
};

const urgencySchema = z.enum(["critical", "high", "medium", "low", "noise"]);
const categorySchema = z.enum(["reply_needed", "deadline", "meeting", "billing", "fyi", "promo"]);

const analysisResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      urgency: urgencySchema,
      score: z.number().min(0).max(100),
      reason: z.string().min(4).max(160),
      category: categorySchema,
    }),
  ),
});

const URGENCY_WEIGHT: Record<InboxUrgency, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  noise: 4,
};

function buildAnalysisPrompt(threads: InboxRankInput[]) {
  const lines = threads.slice(0, 40).map((thread, index) => {
    const subject = (thread.subject?.trim() || "No subject").slice(0, 80);
    const from = (thread.from?.trim() || "Unknown sender").slice(0, 40);
    const snippet = (thread.snippet.trim() || "(empty)").slice(0, 120);
    return `${index + 1}. id=${thread.id} | from=${from} | subject=${subject} | ${snippet}`;
  });

  return [
    "Analyze these email threads for a busy professional.",
    "For EACH thread return:",
    "- urgency: critical | high | medium | low | noise",
    "- score: 0-100 (100 = must handle today)",
    "- reason: one specific sentence explaining WHY (mention sender intent, deadline, or risk — never generic)",
    "- category: reply_needed | deadline | meeting | billing | fyi | promo",
    "",
    "Scoring guide:",
    "- critical (90-100): direct ask waiting on user, deadline today, security/billing",
    "- high (70-89): reply expected, time-sensitive this week",
    "- medium (40-69): useful but not urgent",
    "- low (15-39): FYI, newsletters with some relevance",
    "- noise (0-14): promotions, automated, no action",
    "",
    'Return JSON only: {"items":[{"id":"...","urgency":"high","score":82,"reason":"...","category":"reply_needed"}, ...]}',
    "Include every thread id exactly once.",
    "",
    ...lines,
  ].join("\n");
}

const BATCH_SIZE = 12;

function hashScore(seed: string, min: number, max: number): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const span = max - min + 1;
  return min + (hash % span);
}

function fallbackItem(thread: InboxRankInput): InboxRankItem {
  const subject = thread.subject?.toLowerCase() ?? "";
  const snippet = thread.snippet.toLowerCase();
  const from = thread.from?.toLowerCase() ?? "";
  const text = `${subject} ${snippet}`;

  const looksPromo =
    /unsubscribe|newsletter|promo|sale|off\b|marketing|digest|no-reply|noreply/.test(text) ||
    /no-reply|noreply/.test(from);
  const looksCritical =
    /urgent|asap|deadline|due today|action required|security alert|overdue|past due/.test(text);
  const looksHigh =
    /please reply|waiting for your|follow up|invoice|payment|contract|offer expires|confirm by/.test(text);
  const looksMeeting = /meeting|calendar|invite|schedule|rsvp|sync/.test(text);
  const looksBilling = /invoice|receipt|billing|payment due|subscription/.test(text);

  if (looksPromo) {
    return {
      id: thread.id,
      urgency: "noise",
      score: hashScore(thread.id, 4, 12),
      reason: "Promotional or automated — low action needed.",
      category: "promo",
    };
  }
  if (looksCritical) {
    return {
      id: thread.id,
      urgency: "critical",
      score: hashScore(thread.id, 88, 96),
      reason: "Subject or snippet flags a deadline, security issue, or urgent ask.",
      category: looksBilling ? "billing" : "deadline",
    };
  }
  if (looksHigh) {
    return {
      id: thread.id,
      urgency: "high",
      score: hashScore(thread.id, 72, 86),
      reason: "Looks like a reply, billing item, or time-bound request.",
      category: looksBilling ? "billing" : "reply_needed",
    };
  }
  if (looksMeeting) {
    return {
      id: thread.id,
      urgency: "medium",
      score: hashScore(thread.id, 48, 62),
      reason: "Calendar or meeting-related — check timing if relevant.",
      category: "meeting",
    };
  }

  const score = hashScore(thread.id, 28, 44);
  return {
    id: thread.id,
    urgency: "low",
    score,
    reason: subject
      ? `FYI from “${(thread.subject ?? "").slice(0, 48)}” — no urgent cues detected.`
      : "General inbox item — skim when you have time.",
    category: "fyi",
  };
}

function normalizeItems(threads: InboxRankInput[], raw: z.infer<typeof analysisResponseSchema>): InboxRankItem[] {
  const byId = new Map(raw.items.map((item) => [item.id, item]));
  const normalized: InboxRankItem[] = [];

  for (const thread of threads) {
    const item = byId.get(thread.id);
    if (!item) {
      normalized.push(fallbackItem(thread));
      continue;
    }
    normalized.push({
      id: item.id,
      urgency: item.urgency,
      score: Math.round(Math.max(0, Math.min(100, item.score))),
      reason: item.reason.trim(),
      category: item.category,
    });
  }

  normalized.sort((a, b) => {
    const urgencyDiff = URGENCY_WEIGHT[a.urgency] - URGENCY_WEIGHT[b.urgency];
    if (urgencyDiff !== 0) return urgencyDiff;
    return b.score - a.score;
  });

  return normalized;
}

function buildSummary(items: InboxRankItem[]): InboxAnalysisResult["summary"] {
  return {
    total: items.length,
    critical: items.filter((i) => i.urgency === "critical").length,
    high: items.filter((i) => i.urgency === "high").length,
    medium: items.filter((i) => i.urgency === "medium").length,
    low: items.filter((i) => i.urgency === "low").length,
    noise: items.filter((i) => i.urgency === "noise").length,
    replyNeeded: items.filter((i) => i.category === "reply_needed").length,
    analyzedAt: new Date().toISOString(),
  };
}

export function isInboxAiConfigured() {
  return isOpenAiConfigured();
}

async function analyzeBatch(threads: InboxRankInput[]): Promise<InboxRankItem[]> {
  const content = await createChatCompletion(
    [
      {
        role: "system",
        content:
          "You triage email for executives. Be specific in reasons — cite subject cues, sender type, or implied deadline. Respond with valid JSON only.",
      },
      { role: "user", content: buildAnalysisPrompt(threads) },
    ],
    { jsonObject: true, temperature: 0.15 },
  );

  try {
    const parsed = analysisResponseSchema.parse(JSON.parse(content));
    return normalizeItems(threads, parsed);
  } catch {
    const items = threads.map((thread) => fallbackItem(thread));
    items.sort((a, b) => {
      const urgencyDiff = URGENCY_WEIGHT[a.urgency] - URGENCY_WEIGHT[b.urgency];
      if (urgencyDiff !== 0) return urgencyDiff;
      return b.score - a.score;
    });
    return items;
  }
}

function sortRankItems(items: InboxRankItem[]): InboxRankItem[] {
  return [...items].sort((a, b) => {
    const urgencyDiff = URGENCY_WEIGHT[a.urgency] - URGENCY_WEIGHT[b.urgency];
    if (urgencyDiff !== 0) return urgencyDiff;
    return b.score - a.score;
  });
}

export async function analyzeInboxThreads(threads: InboxRankInput[]): Promise<InboxAnalysisResult> {
  if (!isOpenAiConfigured()) {
    throw new ServiceError("PRECONDITION_FAILED", "OpenAI is not configured. Set OPENAI_API_KEY.");
  }

  if (threads.length === 0) {
    return {
      rankedIds: [],
      items: [],
      summary: {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        noise: 0,
        replyNeeded: 0,
        analyzedAt: new Date().toISOString(),
      },
    };
  }

  if (threads.length === 1) {
    const only = threads[0]!;
    const item: InboxRankItem = {
      id: only.id,
      urgency: "medium",
      score: 50,
      reason: "Single thread — open to see if a reply is needed.",
      category: "fyi",
    };
    return {
      rankedIds: [only.id],
      items: [item],
      summary: buildSummary([item]),
    };
  }

  const batches: InboxRankInput[][] = [];
  for (let i = 0; i < threads.length; i += BATCH_SIZE) {
    batches.push(threads.slice(i, i + BATCH_SIZE));
  }

  const batchResults = await Promise.all(batches.map((batch) => analyzeBatch(batch)));
  const items = sortRankItems(batchResults.flat());

  return {
    rankedIds: items.map((i) => i.id),
    items,
    summary: buildSummary(items),
  };
}

/** Backward-compatible helper — returns ordered ids only. */
export async function rankInboxThreads(threads: InboxRankInput[]): Promise<string[]> {
  const analysis = await analyzeInboxThreads(threads);
  return analysis.rankedIds;
}
