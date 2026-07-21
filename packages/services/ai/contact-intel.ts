/**
 * Contact (Relationship) Intelligence
 *
 * For a given email address:
 * 1. Fetch sent + received threads via Corsair Gmail search
 * 2. Extract interaction timeline, response rate, key topics
 * 3. OpenAI: synthesize relationship summary and recommended next action
 */
import { getInboxService } from "../inbox";
import { createChatCompletion, isOpenAiConfigured } from "./openai";
import { daysSince, extractEmailAddress } from "./daily-brief-time";

export type ContactIntelResult = {
  email: string;
  name?: string;
  totalInteractions: number;
  lastInteractionDaysAgo: number | null;
  lastInteractionDate?: string;
  sentByUser: number;
  receivedFromContact: number;
  /** Estimated response rate 0–1 */
  responseRate: number | null;
  recentTopics: string[];
  relationshipSummary: string;
  recommendedAction: string;
  recentThreads: Array<{ id: string; subject: string; date?: string; direction: "sent" | "received" }>;
};

const SYSTEM_PROMPT = `You are a relationship intelligence assistant. Given email interaction data between a user and a contact, produce:
- relationshipSummary: 1-2 sentences describing the relationship quality, recency, and context
- recommendedAction: 1 clear sentence — what the user should do next with this contact
- recentTopics: array of 2-4 topic keywords from the email subjects

Respond with valid JSON only:
{
  "relationshipSummary": "...",
  "recommendedAction": "...",
  "recentTopics": ["...", "..."]
}`;

export async function getContactIntel(input: {
  tenantId: string;
  email: string;
  name?: string;
  userEmail?: string;
}): Promise<ContactIntelResult> {
  const inbox = getInboxService();

  const status = await inbox.getConnectionStatus(input.tenantId);
  const gmailConnected = status.gmail === "connected";

  const contactEmail = extractEmailAddress(input.email) || input.email;
  const contactName = input.name ?? contactEmail.split("@")[0] ?? contactEmail;

  let sentThreads: Array<{ id: string; subject?: string; date?: string; from?: string }> = [];
  let receivedThreads: Array<{ id: string; subject?: string; date?: string; from?: string }> = [];

  if (gmailConnected) {
    try {
      const [sentResult, receivedResult] = await Promise.all([
        inbox.listThreads(input.tenantId, {
          query: `to:${contactEmail} in:sent`,
          maxResults: 15,
        }),
        inbox.listThreads(input.tenantId, {
          query: `from:${contactEmail}`,
          maxResults: 15,
        }),
      ]);
      sentThreads = sentResult.threads ?? [];
      receivedThreads = receivedResult.threads ?? [];
    } catch {
      // best-effort
    }
  }

  // Deduplicate by thread ID — the same thread can appear in both sent and
  // received results (e.g. a reply thread). Prefer the "received" direction
  // when both exist so the contact's reply is counted as the interaction.
  const seenIds = new Set<string>();
  const allThreads: Array<{ id: string; subject?: string; date?: string; from?: string; direction: "sent" | "received" }> = [];
  for (const t of [
    ...receivedThreads.map((t) => ({ ...t, direction: "received" as const })),
    ...sentThreads.map((t) => ({ ...t, direction: "sent" as const })),
  ]) {
    if (!seenIds.has(t.id)) {
      seenIds.add(t.id);
      allThreads.push(t);
    }
  }
  allThreads.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  const totalInteractions = allThreads.length;
  const lastThread = allThreads[0];
  const lastInteractionDaysAgo = lastThread?.date ? daysSince(lastThread.date) : null;
  const responseRate =
    sentThreads.length > 0 && receivedThreads.length > 0
      ? Math.min(1, receivedThreads.length / sentThreads.length)
      : null;

  const recentThreadsForResult = allThreads.slice(0, 8).map((t) => ({
    id: t.id,
    subject: t.subject ?? "(no subject)",
    date: t.date,
    direction: t.direction,
  }));

  // AI synthesis
  let relationshipSummary = `You have exchanged ${totalInteractions} emails with ${contactName}.`;
  let recommendedAction = `Send a follow-up to ${contactName}.`;
  let recentTopics: string[] = [];

  if (isOpenAiConfigured() && totalInteractions > 0) {
    try {
      const subjectList = allThreads
        .slice(0, 10)
        .map((t, i) => `${i + 1}. [${t.direction}] ${t.subject ?? "(no subject)"} (${t.date ? new Date(t.date).toLocaleDateString() : "unknown date"})`)
        .join("\n");

      const prompt = [
        `Contact: ${contactName} <${contactEmail}>`,
        `Total interactions: ${totalInteractions} (${sentThreads.length} sent, ${receivedThreads.length} received)`,
        lastInteractionDaysAgo !== null
          ? `Last interaction: ${lastInteractionDaysAgo} days ago`
          : "Last interaction: unknown",
        responseRate !== null
          ? `Estimated response rate: ${Math.round(responseRate * 100)}%`
          : "",
        "",
        "Recent email subjects:",
        subjectList,
      ]
        .filter(Boolean)
        .join("\n");

      const raw = await createChatCompletion(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        { jsonObject: true, temperature: 0.4 },
      );

      const parsed = JSON.parse(raw) as {
        relationshipSummary?: string;
        recommendedAction?: string;
        recentTopics?: string[];
      };

      if (parsed.relationshipSummary) relationshipSummary = parsed.relationshipSummary;
      if (parsed.recommendedAction) recommendedAction = parsed.recommendedAction;
      if (Array.isArray(parsed.recentTopics)) recentTopics = parsed.recentTopics.slice(0, 4);
    } catch {
      // fallback to defaults
    }
  }

  return {
    email: contactEmail,
    name: contactName,
    totalInteractions,
    lastInteractionDaysAgo,
    lastInteractionDate: lastThread?.date,
    sentByUser: sentThreads.length,
    receivedFromContact: receivedThreads.length,
    responseRate,
    recentTopics,
    relationshipSummary,
    recommendedAction,
    recentThreads: recentThreadsForResult,
  };
}
