/**
 * Thread Summarizer
 *
 * For an email thread:
 * 1. Fetch full thread via Corsair Gmail (messages + metadata)
 * 2. OpenAI: extract key decisions, action items, next steps
 */
import { getInboxService } from "../inbox";
import { createChatCompletion, isOpenAiConfigured } from "./openai";

export type ThreadSummaryResult = {
  threadId: string;
  subject: string;
  participantCount: number;
  messageCount: number;
  summary: string;
  keyDecisions: string[];
  actionItems: Array<{ action: string; owner?: string; deadline?: string }>;
  nextStep: string;
  sentiment: "positive" | "neutral" | "urgent" | "negative";
};

const SYSTEM_PROMPT = `You are an expert email analyst. Given an email thread, extract:
- summary: 2-3 sentence overview of what the thread is about
- keyDecisions: list of decisions that were made (empty array if none)
- actionItems: list of action items with optional owner and deadline
- nextStep: the single most important next action
- sentiment: overall tone — one of: positive, neutral, urgent, negative

Respond with valid JSON only:
{
  "summary": "...",
  "keyDecisions": ["..."],
  "actionItems": [{ "action": "...", "owner": "...", "deadline": "..." }],
  "nextStep": "...",
  "sentiment": "neutral"
}`;

export async function summarizeThread(input: {
  tenantId: string;
  threadId: string;
  userEmail?: string;
}): Promise<ThreadSummaryResult> {
  const inbox = getInboxService();

  const thread = await inbox.getThread(input.tenantId, input.threadId, {
    userEmail: input.userEmail,
  });

  const subject = thread?.subject?.trim() ?? "(no subject)";
  const messages = thread?.messages ?? [];
  const participants = new Set(
    messages.map((m) => m.from ?? "").filter(Boolean),
  );

  if (!messages.length || !isOpenAiConfigured()) {
    return {
      threadId: input.threadId,
      subject,
      participantCount: participants.size,
      messageCount: messages.length,
      summary: messages.length
        ? `Thread with ${messages.length} messages about "${subject}".`
        : "No messages found in this thread.",
      keyDecisions: [],
      actionItems: [],
      nextStep: "Review the thread and determine next steps.",
      sentiment: "neutral",
    };
  }

  // Build thread text for OpenAI — last 8 messages max
  // Include attachment filenames so AI knows what's attached (content not read)
  const threadText = messages
    .slice(-8)
    .map((m, i) => {
      const from = m.from ?? "Unknown";
      const date = m.date ? new Date(m.date).toLocaleDateString() : "";
      const body = (m.body ?? "").slice(0, 600).replace(/\n{3,}/g, "\n\n");
      const attachmentLine =
        m.attachments && m.attachments.length > 0
          ? `\nAttachments: ${m.attachments.map((a) => `${a.filename} (${a.mimeType})`).join(", ")}`
          : "";
      return `[Message ${i + 1}] From: ${from}${date ? ` (${date})` : ""}${attachmentLine}\n${body}`;
    })
    .join("\n\n---\n\n");

  // Collect all unique attachment names for a summary line
  const allAttachments = messages
    .flatMap((m) => m.attachments ?? [])
    .map((a) => a.filename)
    .filter(Boolean);
  const attachmentSummary =
    allAttachments.length > 0 ? `\nAttachments in thread: ${allAttachments.join(", ")}` : "";

  const prompt = `Subject: ${subject}\nParticipants: ${[...participants].join(", ")}${attachmentSummary}\n\nThread:\n${threadText}`;

  type RawResult = {
    summary?: string;
    keyDecisions?: string[];
    actionItems?: Array<{ action?: string; owner?: string; deadline?: string }>;
    nextStep?: string;
    sentiment?: string;
  };

  try {
    const raw = await createChatCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      { jsonObject: true, temperature: 0.3 },
    );

    const parsed = JSON.parse(raw) as RawResult;

    const validSentiments = ["positive", "neutral", "urgent", "negative"] as const;
    type Sentiment = (typeof validSentiments)[number];
    const sentiment: Sentiment = validSentiments.includes(parsed.sentiment as Sentiment)
      ? (parsed.sentiment as Sentiment)
      : "neutral";

    return {
      threadId: input.threadId,
      subject,
      participantCount: participants.size,
      messageCount: messages.length,
      summary: parsed.summary ?? `Thread with ${messages.length} messages about "${subject}".`,
      keyDecisions: parsed.keyDecisions ?? [],
      actionItems: (parsed.actionItems ?? [])
        .filter((a) => a.action)
        .map((a) => ({ action: a.action!, owner: a.owner, deadline: a.deadline })),
      nextStep: parsed.nextStep ?? "Follow up on this thread.",
      sentiment,
    };
  } catch {
    return {
      threadId: input.threadId,
      subject,
      participantCount: participants.size,
      messageCount: messages.length,
      summary: `Thread with ${messages.length} messages about "${subject}".`,
      keyDecisions: [],
      actionItems: [],
      nextStep: "Review the thread and determine next steps.",
      sentiment: "neutral",
    };
  }
}
