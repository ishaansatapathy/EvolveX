/**
 * Streaming wrapper around the shared agent tool executor.
 *
 * Accepts an `onToolCall` callback invoked before each tool so the HTTP layer
 * can push SSE "status" events to the client (real-time "Searching inbox…" UX).
 * Delegates all tool logic to `buildToolExecutor` from agent-executor.ts —
 * no tool cases are duplicated here.
 */

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
import type { AgentActionCard, AgentChatResult, AgentHistoryMessage } from "./agent";
import { buildToolExecutor } from "./agent-executor";

import { AGENT_TOOLS } from "./agent-internals";
import { createToolMemoryTracker, prepareAgentRun } from "./agent-run";
import { summarizeToolResult } from "./agent-tool-memory";
import type { AgentToolMemoryEntry } from "./agent-tool-memory";
import type { AgentFocus } from "./agent-focus";

export async function runAgentChatStream(
  tenantId: string,
  input: {
    message: string;
    history?: AgentHistoryMessage[];
    userEmail?: string;
    focus?: AgentFocus;
    toolMemory?: AgentToolMemoryEntry[];
  },
  onToolCall: (toolName: string) => void,
  onTokenDelta?: (delta: string) => void,
  opts?: { signal?: AbortSignal },
): Promise<AgentChatResult> {
  if (!isOpenAiConfigured()) {
    throw new ServiceError("PRECONDITION_FAILED", "OpenAI is not configured. Set OPENAI_API_KEY.");
  }

  const injectionCheck = detectInjectionAttempt(input.message);
  if (injectionCheck.flagged) {
    logger.warn("agent.stream.injection_blocked", { tenantId, reason: injectionCheck.reason });
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
  if (estimateTokenCount(previewMessages) > MAX_AGENT_CONTEXT_TOKENS) {
    return {
      reply: "The conversation history is too long. Please start a new conversation.",
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
    onToolCall(name);
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
    onToken: onTokenDelta,
    signal: opts?.signal,
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
