import { logger } from "@repo/logger";
import { getCalendarService } from "../calendar";
import { ServiceError } from "../errors";
import { getInboxService } from "../inbox";
import { getQueueService } from "../queue";
import { getSettingsService } from "../settings";
import { isOpenAiConfigured } from "./openai";
import type { OpenAiConversationMessage } from "./openai-tools";
import { runOpenAiToolLoop } from "./openai-tools";
import {
  detectInjectionAttempt,
  estimateTokenCount,
  MAX_AGENT_CONTEXT_TOKENS,
} from "./agent-guard";
import { AGENT_TOOLS } from "./agent-internals";
import { buildToolExecutor } from "./agent-executor";
import { createToolMemoryTracker, prepareAgentRun } from "./agent-run";
import { summarizeToolResult } from "./agent-tool-memory";
import type { AgentFocus } from "./agent-focus";

export type AgentHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentActionCard = {
  kind: "email_queued" | "calendar_queued" | "inbox_search" | "inbox_ranked" | "queue_list" | "thread" | "calendar" | "email";
  title: string;
  detail?: string;
  href?: string;
  lines?: string[];
  disposition?: "sent" | "queued";
  queueItemId?: string;
  threadId?: string;
};

export type AgentChatResult = {
  reply: string;
  actions: AgentActionCard[];
  focusCleared?: boolean;
  effectiveFocus?: AgentFocus;
  toolMemory?: import("./agent-tool-memory").AgentToolMemoryEntry[];
  newToolMemoryEntries?: import("./agent-tool-memory").AgentToolMemoryEntry[];
};

export function isAgentConfigured() {
  return isOpenAiConfigured();
}

export async function runAgentChat(
  tenantId: string,
  input: {
    message: string;
    history?: AgentHistoryMessage[];
    userEmail?: string;
    focus?: AgentFocus;
    toolMemory?: import("./agent-tool-memory").AgentToolMemoryEntry[];
  },
): Promise<AgentChatResult> {
  if (!isOpenAiConfigured()) {
    throw new ServiceError("PRECONDITION_FAILED", "OpenAI is not configured. Set OPENAI_API_KEY.");
  }

  const injectionCheck = detectInjectionAttempt(input.message);
  if (injectionCheck.flagged) {
    logger.warn("agent.injection_attempt_blocked", {
      tenantId,
      reason: injectionCheck.reason,
      messagePreview: input.message.slice(0, 200),
    });
    return {
      reply:
        "I can't process that request as it appears to contain instructions that could compromise security. " +
        "If you were trying to do something specific, please rephrase it.",
      actions: [],
    };
  }

  const history =
    input.focus?.threadId || input.focus?.eventId
      ? (input.history ?? []).slice(-4)
      : (input.history ?? []);

  const previewMessages: OpenAiConversationMessage[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: input.message.trim() },
  ];
  const estimatedTokens = estimateTokenCount(previewMessages);
  if (estimatedTokens > MAX_AGENT_CONTEXT_TOKENS) {
    logger.warn("agent.context_too_large", { tenantId, estimatedTokens });
    return {
      reply: "The conversation history is too long for me to process safely. Please start a new conversation.",
      actions: [],
    };
  }

  const inbox = getInboxService();
  const queue = getQueueService();
  const calendar = getCalendarService();
  const settings = getSettingsService();
  const approvalDefaults = await settings.getApprovalDefaults(tenantId);
  const actions: AgentActionCard[] = [];
  const emailQueueFingerprints = new Set<string>();
  const sendCounter = { count: 0 };

  const prepared = await prepareAgentRun(tenantId, input, approvalDefaults);
  const memoryTracker = createToolMemoryTracker(prepared, input.toolMemory ?? []);

  const baseExecutor = buildToolExecutor({
    tenantId,
    userEmail: input.userEmail,
    approvalDefaults,
    inbox,
    queue,
    calendar,
    actions,
    emailQueueFingerprints,
    sendCounter,
  });

  const executeTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const result = await baseExecutor(name, args);
    memoryTracker.track(summarizeToolResult(name, result, args));
    return result;
  };

  const messages: OpenAiConversationMessage[] = [
    { role: "system", content: prepared.systemPrompt },
    ...prepared.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.message.trim() },
  ];

  const { content } = await runOpenAiToolLoop(messages, AGENT_TOOLS, executeTool, {
    maxRounds: 6,
    timeoutMs: 120_000,
  });

  return {
    reply: content,
    actions,
    focusCleared: prepared.focusCleared,
    effectiveFocus: prepared.effectiveFocus,
    toolMemory: memoryTracker.getMergedMemory(),
    newToolMemoryEntries: memoryTracker.getNewEntries(),
  };
}
