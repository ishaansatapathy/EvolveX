/**
 * Shared tool-executor factory for the Thread Agent.
 *
 * Both `agent.ts` (blocking) and `agent-stream.ts` (SSE streaming) build their
 * `executeTool` function from this single source of truth, eliminating the ~450-
 * line duplication that previously existed between the two files.
 *
 * 57 tools — in full parity with the MCP server (see mcp-server.json).
 */

import { logger } from "@repo/logger";
import type { CalendarService } from "../calendar";
import { getContactsService } from "../contacts";
import { ServiceError } from "../errors";
import type { InboxService } from "../inbox";
import type { QueueService } from "../queue";
import type { ApprovalDefaults } from "../settings";
import { getContactIntel } from "./contact-intel";
import {
  enforceEmailSendCap,
  fenceEmailData,
  validateAgentEmailArgs,
  type SendCounter,
} from "./agent-guard";
import { generateDailyBrief } from "./daily-brief";
import { getMeetingPrep } from "./meeting-prep";
import { getMissedFollowUps } from "./missed-followups";
import { analyzeInboxThreads } from "./inbox-priority";
import { getSmartReplies } from "./smart-reply";
import { getThreadContext } from "./thread-context";
import { summarizeThread } from "./summarize-thread";
import { threadLine } from "./agent-internals";
import type { AgentActionCard } from "./agent";

export type AgentExecutorContext = {
  tenantId: string;
  userEmail?: string;
  approvalDefaults: ApprovalDefaults;
  inbox: InboxService;
  queue: QueueService;
  calendar: CalendarService;
  actions: AgentActionCard[];
  emailQueueFingerprints: Set<string>;
  sendCounter: SendCounter;
};

/**
 * Returns the async `executeTool(name, args)` function used by `runOpenAiToolLoop`.
 * Wrap the returned function to inject `onToolCall(name)` for streaming status events.
 */
export function buildToolExecutor(ctx: AgentExecutorContext) {
  const { tenantId, userEmail, approvalDefaults, inbox, queue, calendar, actions, emailQueueFingerprints, sendCounter } = ctx;

  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    switch (name) {
      // ── Inbox reads ──────────────────────────────────────────────────────────

      case "list_inbox": {
        const maxResults = Math.min(Math.max(Number(args.maxResults) || 20, 1), 50);
        const query = typeof args.query === "string" ? args.query.trim() : undefined;
        const result = await inbox.listThreads(tenantId, { maxResults, query });
        const lines = result.threads.map((t) => threadLine(t));
        actions.push({
          kind: "inbox_search",
          title: query ? `Inbox: ${query}` : "Recent inbox",
          detail: `${result.threads.length} thread(s)`,
          href: "/inbox",
          lines: lines.slice(0, 8),
        });
        return JSON.stringify({ threads: result.threads.map((t) => ({ ...t, snippet: fenceEmailData(t.snippet) })), count: result.threads.length });
      }

      case "search_inbox": {
        const query = typeof args.query === "string" ? args.query.trim() : undefined;
        const maxResults = Math.min(Math.max(Number(args.maxResults) || 10, 1), 25);
        const result = await inbox.listThreads(tenantId, { maxResults, query });
        const lines = result.threads.map((t) => threadLine(t));
        actions.push({
          kind: "inbox_search",
          title: query ? `Search: ${query}` : "Recent inbox",
          detail: `${result.threads.length} thread(s)`,
          href: query ? `/inbox?focus=search` : "/inbox",
          lines: lines.slice(0, 8),
        });
        return JSON.stringify({
          threads: result.threads.map((t) => ({ ...t, snippet: fenceEmailData(t.snippet) })),
          count: result.threads.length,
        });
      }

      case "get_thread": {
        const threadId = String(args.threadId ?? "");
        const thread = await inbox.getThread(tenantId, threadId, { userEmail });
        if (!thread) return JSON.stringify({ error: "Thread not found" });
        const fencedMessages = (thread.messages ?? []).slice(0, 5).map((m) => ({
          from: m.from ?? "?",
          body: fenceEmailData(m.body.slice(0, 2000)),
        }));
        actions.push({
          kind: "thread",
          title: thread.subject?.trim() || "Thread",
          detail: thread.fromName || thread.from,
          href: `/inbox?thread=${encodeURIComponent(threadId)}`,
          lines: (thread.messages ?? []).slice(0, 5).map((m) => `${m.from ?? "?"}: ${m.body.slice(0, 200)}`),
        });
        return JSON.stringify({ thread: { ...thread, messages: fencedMessages } });
      }

      case "rank_inbox": {
        const maxResults = Math.min(Math.max(Number(args.maxResults) || 15, 1), 25);
        const listed = await inbox.listThreads(tenantId, { maxResults });
        const analysis = await analyzeInboxThreads(
          listed.threads.map((t) => ({ id: t.id, snippet: t.snippet, subject: t.subject, from: t.fromName ?? t.from })),
        );
        const byId = new Map(listed.threads.map((t) => [t.id, t]));
        const ordered = analysis.rankedIds.map((id) => byId.get(id)).filter(Boolean);
        const topLines = analysis.items
          .filter((item) => item.urgency !== "noise")
          .slice(0, 8)
          .map((item) => {
            const thread = byId.get(item.id);
            const label = thread ? threadLine(thread) : item.id;
            return `[${item.urgency.toUpperCase()} · ${item.score}] ${label} — ${item.reason}`;
          });
        actions.push({
          kind: "inbox_ranked",
          title: "Inbox analysis",
          detail: `${analysis.summary.critical + analysis.summary.high} need attention · ${analysis.summary.replyNeeded} need a reply`,
          href: "/inbox",
          lines: topLines.length > 0 ? topLines : ordered.slice(0, 5).map((t) => threadLine(t!)),
        });
        return JSON.stringify(analysis);
      }

      case "get_gmail_connection_status": {
        const status = await inbox.getConnectionStatus(tenantId);
        return JSON.stringify({ status: status.gmail, connected: status.gmail === "connected" });
      }

      // ── Inbox writes ─────────────────────────────────────────────────────────

      case "queue_email": {
        let validated: { to: string; subject: string; body: string };
        try {
          validated = validateAgentEmailArgs(args);
        } catch (err) {
          return JSON.stringify({ success: false, error: err instanceof ServiceError ? err.message : "Invalid email parameters" });
        }
        const { to, subject, body } = validated;
        const mode = args.mode === "draft" ? "draft" : "send";
        const threadId = typeof args.threadId === "string" ? args.threadId : undefined;
        const cc = typeof args.cc === "string" ? args.cc.trim() : undefined;
        const bcc = typeof args.bcc === "string" ? args.bcc.trim() : undefined;

        if (mode === "send") {
          try { enforceEmailSendCap(sendCounter); }
          catch (err) {
            logger.warn("agent.send_cap_exceeded", { tenantId, to, subject, count: sendCounter.count });
            return JSON.stringify({ success: false, error: err instanceof ServiceError ? err.message : "Send limit exceeded" });
          }
        }

        const fingerprint = `${mode}:${to.toLowerCase()}|${subject}|${body}`;
        if (emailQueueFingerprints.has(fingerprint)) {
          return JSON.stringify({ success: true, duplicate: true, message: "This exact email was already queued in this request." });
        }
        emailQueueFingerprints.add(fingerprint);

        const item = await queue.enqueueEmail(
          tenantId,
          { mode, email: { to, subject, body, threadId, cc, bcc }, title: mode === "draft" ? `Draft: ${subject}` : `Send: ${subject}`, preview: body.slice(0, 240) },
          { origin: "agent" },
        );
        logger.info("agent.email_queued", { tenantId, to, subject, mode, queueItemId: item.id, status: item.status });

        try {
          const contacts = getContactsService();
          await contacts.upsert(tenantId, { email: to, source: "agent" });
          await contacts.touch(tenantId, to);
        } catch { /* best-effort */ }

        const sent = item.status === "approved";
        const pending = item.status === "pending";
        const outcome = sent
          ? mode === "draft" ? "draft_saved" : "email_sent"
          : pending
            ? mode === "draft" ? "draft_queued" : "email_queued_for_approval"
            : "email_queue_failed";

        actions.push({
          kind: "email_queued",
          title: sent
            ? mode === "draft"
              ? "Draft saved"
              : "Email sent"
            : pending
              ? mode === "draft"
                ? "Draft queued"
                : "Send queued for approval"
              : "Send could not be queued",
          detail: `To ${to}`,
          href: sent ? (threadId ? `/inbox?thread=${encodeURIComponent(threadId)}` : undefined) : "/queue",
          disposition: sent ? "sent" : pending ? "queued" : undefined,
          queueItemId: pending ? item.id : undefined,
          threadId: threadId || undefined,
          lines: [`Subject: ${subject}`, body.slice(0, 400)],
        });
        return JSON.stringify({
          success: true,
          queueItemId: item.id,
          status: item.status,
          outcome,
          tellUser: sent
            ? mode === "draft" ? `Draft saved to Gmail for ${to}.` : `Email sent to ${to} via Gmail.`
            : pending
              ? `Email added to Queue for ${to} — user must approve before it sends.`
              : `Could not queue email for ${to} — check Queue or try again.`,
        });
      }

      case "archive_thread": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        await inbox.archiveThread(tenantId, threadId);
        actions.push({ kind: "thread", title: "Thread archived", detail: threadId, href: "/inbox" });
        return JSON.stringify({ success: true, threadId });
      }

      case "star_thread": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        await inbox.starThread(tenantId, threadId);
        actions.push({ kind: "thread", title: "Thread starred", detail: threadId, href: `/inbox?thread=${encodeURIComponent(threadId)}` });
        return JSON.stringify({ success: true, threadId, action: "starred" });
      }

      case "unstar_thread": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        await inbox.unstarThread(tenantId, threadId);
        actions.push({ kind: "thread", title: "Thread unstarred", detail: threadId, href: `/inbox?thread=${encodeURIComponent(threadId)}` });
        return JSON.stringify({ success: true, threadId, action: "unstarred" });
      }

      case "mark_important": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        await inbox.markImportant(tenantId, threadId);
        actions.push({ kind: "thread", title: "Marked important", detail: threadId, href: `/inbox?thread=${encodeURIComponent(threadId)}` });
        return JSON.stringify({ success: true, threadId, action: "marked_important" });
      }

      case "trash_thread": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        await inbox.trashThread(tenantId, threadId);
        actions.push({ kind: "thread", title: "Thread moved to trash", detail: threadId, href: "/inbox" });
        return JSON.stringify({ success: true, threadId, action: "trashed" });
      }

      case "mark_thread_read": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        await inbox.markThreadRead(tenantId, threadId);
        return JSON.stringify({ success: true, threadId, action: "marked_read" });
      }

      case "apply_label": {
        const threadId = String(args.threadId ?? "").trim();
        const labelId = String(args.labelId ?? "").trim();
        if (!threadId || !labelId) return JSON.stringify({ success: false, error: "threadId and labelId are required" });
        await inbox.applyLabel(tenantId, threadId, labelId);
        actions.push({ kind: "thread", title: "Label applied", detail: `${labelId} on ${threadId}`, href: "/inbox" });
        return JSON.stringify({ success: true, threadId, labelId });
      }

      case "remove_label": {
        const threadId = String(args.threadId ?? "").trim();
        const labelId = String(args.labelId ?? "").trim();
        if (!threadId || !labelId) return JSON.stringify({ success: false, error: "threadId and labelId are required" });
        await inbox.removeLabel(tenantId, threadId, labelId);
        actions.push({ kind: "thread", title: "Label removed", detail: `${labelId} from ${threadId}`, href: "/inbox" });
        return JSON.stringify({ success: true, threadId, labelId });
      }

      case "list_labels": {
        const labels = await inbox.listLabels(tenantId);
        return JSON.stringify({ labels });
      }

      // ── Drafts ───────────────────────────────────────────────────────────────

      case "list_drafts": {
        const maxResults = Math.min(25, Math.max(1, Number(args.maxResults ?? 10)));
        const result = await inbox.listDrafts(tenantId, { maxResults });
        actions.push({ kind: "thread", title: `${result.drafts?.length ?? 0} drafts found`, href: "/inbox?view=drafts" });
        return JSON.stringify(result);
      }

      case "get_draft": {
        const draftId = String(args.draftId ?? "").trim();
        if (!draftId) return JSON.stringify({ success: false, error: "draftId is required" });
        const draft = await inbox.getDraft(tenantId, draftId);
        if (!draft) return JSON.stringify({ success: false, error: "Draft not found" });
        return JSON.stringify({ success: true, draft: { ...draft, body: fenceEmailData(draft.body) } });
      }

      case "delete_draft": {
        const draftId = String(args.draftId ?? "").trim();
        if (!draftId) return JSON.stringify({ success: false, error: "draftId is required" });
        await inbox.deleteDraft(tenantId, draftId);
        actions.push({ kind: "thread", title: "Draft deleted", detail: draftId, href: "/inbox?view=drafts" });
        return JSON.stringify({ success: true, draftId, action: "deleted" });
      }

      // ── Queue ────────────────────────────────────────────────────────────────

      case "list_queue": {
        const status = args.status === "all" ? "all" : "pending";
        const items = await queue.listItems(tenantId, { status });
        actions.push({
          kind: "queue_list",
          title: status === "pending" ? "Pending queue" : "All queue items",
          detail: `${items.length} item(s)`,
          href: "/queue",
          lines: items.slice(0, 10).map((i) => `${i.kind}: ${i.title}`),
        });
        return JSON.stringify({ items });
      }

      case "approve_queue_item": {
        const itemId = String(args.itemId ?? "").trim();
        if (!itemId) return JSON.stringify({ success: false, error: "itemId is required" });
        const result = await queue.approve(tenantId, itemId);
        actions.push({ kind: "queue_list", title: "Queue item approved", detail: result.title, href: "/queue", lines: [`${result.kind}: ${result.title}`] });
        return JSON.stringify({ success: true, itemId, status: result.status });
      }

      case "dismiss_queue_item": {
        const itemId = String(args.itemId ?? "").trim();
        if (!itemId) return JSON.stringify({ success: false, error: "itemId is required" });
        await queue.dismiss(tenantId, itemId);
        actions.push({ kind: "queue_list", title: "Queue item dismissed", detail: itemId, href: "/queue" });
        return JSON.stringify({ success: true, itemId });
      }

      // ── Calendar ─────────────────────────────────────────────────────────────

      case "queue_calendar_invite": {
        const summary = String(args.summary ?? "").trim();
        const startDateTime = String(args.startDateTime ?? "").trim();
        const endDateTime = String(args.endDateTime ?? "").trim();
        if (!summary || !startDateTime || !endDateTime) {
          return JSON.stringify({ success: false, error: "summary, startDateTime, and endDateTime are required" });
        }
        const item = await queue.enqueueCalendarInvite(
          tenantId,
          {
            calendar: {
              summary, startDateTime, endDateTime,
              description: typeof args.description === "string" ? args.description : undefined,
              location: typeof args.location === "string" ? args.location : undefined,
              timeZone: typeof args.timeZone === "string" ? args.timeZone : undefined,
              attendeeEmails: Array.isArray(args.attendeeEmails) ? args.attendeeEmails.map(String) : undefined,
              recurrence: Array.isArray(args.recurrence) ? args.recurrence.map(String).slice(0, 5) : undefined,
            },
            title: `Invite: ${summary}`,
            preview: `${startDateTime} → ${endDateTime}`,
          },
          { origin: "agent" },
        );
        logger.info("agent.calendar_queued", { tenantId, summary, startDateTime, endDateTime, queueItemId: item.id, status: item.status });
        const sent = item.status === "approved";
        actions.push({
          kind: "calendar_queued",
          title: sent ? "Calendar invite sent" : "Calendar invite queued",
          detail: summary,
          href: sent ? undefined : "/queue",
          disposition: sent ? "sent" : "queued",
          queueItemId: sent ? undefined : item.id,
          lines: [`Start: ${startDateTime}`, `End: ${endDateTime}`],
        });
        return JSON.stringify({
          success: true,
          queueItemId: item.id,
          status: item.status,
          outcome: sent ? "calendar_sent" : "calendar_queued_for_approval",
          tellUser: sent ? `Calendar invite "${summary}" was created on Google Calendar.` : `Calendar invite "${summary}" is in Queue — user must approve before it is created.`,
        });
      }

      case "list_calendar_events": {
        const query = typeof args.query === "string" ? args.query.trim() : undefined;
        const now = new Date();
        const timeMin =
          String(args.timeMin ?? "").trim() ||
          new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const timeMax =
          String(args.timeMax ?? "").trim() ||
          new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
        const maxResults = Math.min(Math.max(Number(args.maxResults) || 20, 1), 50);
        const result = await calendar.listEvents(tenantId, {
          timeMin,
          timeMax,
          maxResults,
          ...(query ? { q: query } : {}),
        });
        return JSON.stringify({ events: result.events, count: result.events.length, query: query ?? null });
      }

      case "check_free_busy": {
        const startDateTime = String(args.startDateTime ?? "").trim();
        const endDateTime = String(args.endDateTime ?? "").trim();
        const timeZone = String(args.timeZone ?? "UTC").trim();
        if (!startDateTime || !endDateTime) return JSON.stringify({ success: false, error: "startDateTime and endDateTime are required" });
        const result = await calendar.checkFreeBusy(tenantId, { startDateTime, endDateTime, timeZone });
        return JSON.stringify(result);
      }

      case "respond_to_event": {
        const eventId = String(args.eventId ?? "").trim();
        const responseRaw = String(args.response ?? "").trim().toLowerCase();
        const response = responseRaw as "accepted" | "declined" | "tentative";
        if (!eventId || !["accepted", "declined", "tentative"].includes(response)) {
          return JSON.stringify({ success: false, error: "eventId and response (accepted/declined/tentative) are required" });
        }
        const updated = await calendar.respondToEvent(tenantId, eventId, response);
        actions.push({ kind: "calendar", title: `Event ${response}`, detail: updated.summary, href: "/calendar" });
        return JSON.stringify({ success: true, eventId, response, event: updated });
      }

      case "reschedule_event": {
        const eventId = String(args.eventId ?? "").trim();
        const startDateTime = String(args.startDateTime ?? "").trim();
        const endDateTime = String(args.endDateTime ?? "").trim();
        const timeZone = String(args.timeZone ?? "UTC").trim();
        if (!eventId || !startDateTime || !endDateTime) {
          return JSON.stringify({ success: false, error: "eventId, startDateTime, and endDateTime are required" });
        }
        const existing = await calendar.getEvent(tenantId, eventId);
        if (!existing) return JSON.stringify({ success: false, error: "Event not found" });
        const item = await queue.enqueueCalendarArchive(
          tenantId,
          {
            archive: {
              eventId,
              summary: existing.summary ?? "Event",
              startDateTime,
              endDateTime,
              timeZone,
              htmlLink: existing.htmlLink,
              recurringEventId: existing.recurringEventId,
            },
            title: `Reschedule: ${existing.summary ?? "Event"}`,
          },
          { origin: "agent" },
        );
        actions.push({
          kind: "calendar_queued",
          title: "Reschedule queued",
          detail: existing.summary ?? eventId,
          href: "/queue",
          queueItemId: item.id,
          disposition: item.status === "approved" ? "sent" : "queued",
        });
        return JSON.stringify({ success: true, queued: true, queueItemId: item.id, status: item.status });
      }

      case "cancel_event": {
        const eventId = String(args.eventId ?? "").trim();
        if (!eventId) return JSON.stringify({ success: false, error: "eventId is required" });
        const existing = await calendar.getEvent(tenantId, eventId);
        const item = await queue.enqueueCalendarDelete(
          tenantId,
          {
            delete: {
              eventId,
              summary: existing?.summary ?? "Event",
              htmlLink: existing?.htmlLink,
              recurringEventId: existing?.recurringEventId,
              cancelWithNotify: true,
            },
            title: `Cancel: ${existing?.summary ?? eventId}`,
          },
          { origin: "agent" },
        );
        actions.push({
          kind: "calendar_queued",
          title: "Cancel queued",
          detail: existing?.summary ?? eventId,
          href: "/queue",
          queueItemId: item.id,
          disposition: item.status === "approved" ? "sent" : "queued",
        });
        return JSON.stringify({ success: true, queued: true, queueItemId: item.id, status: item.status });
      }

      // ── AI ───────────────────────────────────────────────────────────────────

      case "get_daily_brief": {
        const timeZone = String(args.timeZone ?? "UTC").trim();
        const brief = await generateDailyBrief({ tenantId, userEmail, timeZone });
        actions.push({ kind: "thread", title: "Daily Brief", detail: "View your daily brief", href: "/brief" });
        return JSON.stringify(brief);
      }

      case "get_smart_replies": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        const result = await getSmartReplies({ tenantId, threadId, userEmail });
        actions.push({ kind: "thread", title: "Smart replies ready", detail: `${result.suggestions.length} suggestions`, href: `/inbox?thread=${encodeURIComponent(threadId)}` });
        return JSON.stringify(result);
      }

      case "get_meeting_prep": {
        const eventId = String(args.eventId ?? "").trim();
        const timeZone = String(args.timeZone ?? "UTC").trim();
        if (!eventId) return JSON.stringify({ success: false, error: "eventId is required" });
        const prep = await getMeetingPrep({ tenantId, eventId, timeZone });
        actions.push({ kind: "calendar", title: "Meeting prep ready", detail: prep.summary ?? eventId, href: `/calendar?event=${encodeURIComponent(eventId)}` });
        return JSON.stringify(prep);
      }

      case "get_thread_context": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        const ctx2 = await getThreadContext({ tenantId, threadId, userEmail });
        actions.push({ kind: "thread", title: "Thread context", detail: ctx2.nextAction ?? threadId, href: `/inbox?thread=${encodeURIComponent(threadId)}` });
        return JSON.stringify(ctx2);
      }

      case "get_missed_followups": {
        const timeZone = String(args.timeZone ?? "UTC").trim();
        const followups = await getMissedFollowUps({ tenantId, userEmail, timeZone });
        actions.push({ kind: "thread", title: `${followups.length} missed follow-ups`, detail: "Meetings with no follow-up email", href: "/brief" });
        return JSON.stringify({ followups, count: followups.length });
      }

      case "get_contact_intel": {
        const email = String(args.email ?? "").trim();
        const name = args.name ? String(args.name).trim() : undefined;
        if (!email) return JSON.stringify({ success: false, error: "email is required" });
        const intel = await getContactIntel({ tenantId, email, name, userEmail });
        actions.push({ kind: "thread", title: `Relationship: ${intel.name ?? email}`, detail: intel.relationshipSummary, href: `/inbox?q=${encodeURIComponent(`from:${email}`)}` });
        return JSON.stringify(intel);
      }

      case "summarize_thread": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        const summary = await summarizeThread({ tenantId, threadId, userEmail });
        actions.push({ kind: "thread", title: "Thread summarized", detail: summary.subject, href: `/inbox?thread=${encodeURIComponent(threadId)}` });
        return JSON.stringify(summary);
      }

      // ── 5 new tools (39 total) ─────────────────────────────────────────────

      case "mark_not_important": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        await inbox.markNotImportant(tenantId, threadId);
        actions.push({ kind: "thread", title: "Marked not important", detail: threadId, href: "/inbox" });
        return JSON.stringify({ success: true, threadId, action: "marked_not_important" });
      }

      case "get_calendar_event": {
        const eventId = String(args.eventId ?? "").trim();
        if (!eventId) return JSON.stringify({ success: false, error: "eventId is required" });
        const event = await calendar.getEvent(tenantId, eventId);
        if (!event) return JSON.stringify({ success: false, error: "Event not found" });
        return JSON.stringify(event);
      }

      case "find_meeting_slots": {
        const durationMinutes = Math.max(15, Math.min(480, Number(args.durationMinutes ?? 30)));
        const { findMeetingSlots } = await import("./meeting-slots");
        const result = await findMeetingSlots({
          tenantId,
          durationMinutes,
          preferredStartDate: args.preferredStartDate ? String(args.preferredStartDate) : undefined,
          preferredEndDate: args.preferredEndDate ? String(args.preferredEndDate) : undefined,
          timeZone: args.timeZone ? String(args.timeZone) : undefined,
          attendeeEmail: args.attendeeEmail ? String(args.attendeeEmail) : undefined,
          context: args.context ? String(args.context) : undefined,
        });
        if (result.slots.length > 0) {
          actions.push({ kind: "calendar", title: `${result.slots.length} meeting slots found`, detail: result.slots[0]!.label, href: "/calendar" });
        }
        return JSON.stringify(result);
      }

      case "create_draft_email": {
        const to = String(args.to ?? "").trim();
        const subject = String(args.subject ?? "").trim();
        const body = String(args.body ?? "").trim();
        if (!to || !subject || !body) return JSON.stringify({ success: false, error: "to, subject, and body are required" });
        const draft = await inbox.createDraft(tenantId, {
          to,
          subject,
          body,
          threadId: args.threadId ? String(args.threadId) : undefined,
          cc: args.cc ? String(args.cc) : undefined,
          bcc: args.bcc ? String(args.bcc) : undefined,
        });
        actions.push({ kind: "thread", title: "Draft saved", detail: subject, href: "/inbox" });
        return JSON.stringify({ success: true, draftId: draft.id, subject, to });
      }

      case "update_event_details": {
        const eventId = String(args.eventId ?? "").trim();
        if (!eventId) return JSON.stringify({ success: false, error: "eventId is required" });
        const newSummary = args.summary ? String(args.summary).trim() : undefined;
        const description = args.description ? String(args.description) : undefined;
        const location = args.location ? String(args.location) : undefined;
        if (!newSummary && !description && !location) {
          return JSON.stringify({ success: false, error: "At least one of summary, description, or location is required" });
        }
        const existing = await calendar.getEvent(tenantId, eventId);
        if (!existing) return JSON.stringify({ success: false, error: "Event not found" });
        const item = await queue.enqueueCalendarUpdate(
          tenantId,
          {
            update: {
              eventId,
              summary: existing.summary ?? "Event",
              newSummary,
              description,
              location,
              htmlLink: existing.htmlLink,
            },
            title: `Update: ${existing.summary ?? "Event"}`,
          },
          { origin: "agent" },
        );
        const disposition = item.status === "approved" ? "updated" : "queued";
        actions.push({
          kind: "calendar",
          title: disposition === "updated" ? "Event updated" : "Event update queued",
          detail: newSummary ?? existing.summary ?? eventId,
          href: disposition === "updated" ? "/calendar" : "/queue",
        });
        return JSON.stringify({ success: true, queued: item.status !== "approved", queueItemId: item.id, status: item.status });
      }

      case "mark_thread_unread": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        await inbox.markThreadUnread(tenantId, threadId);
        return JSON.stringify({ success: true, threadId, action: "marked_unread" });
      }

      case "quick_add_event": {
        const text = String(args.text ?? "").trim();
        if (!text) return JSON.stringify({ success: false, error: "text is required" });
        const item = await queue.enqueueQuickAddCalendar(tenantId, { text }, { origin: "agent" });
        const disposition = item.status === "approved" ? "sent" : "queued";
        actions.push({
          kind: "calendar_queued",
          title: item.title,
          detail: text,
          href: "/queue",
          disposition,
          queueItemId: item.id,
        });
        return JSON.stringify({ success: true, queued: disposition === "queued", itemId: item.id });
      }

      case "send_draft": {
        const draftId = String(args.draftId ?? "").trim();
        if (!draftId) return JSON.stringify({ success: false, error: "draftId is required" });
        const item = await queue.enqueueDraftSend(tenantId, { draftId }, { origin: "agent" });
        const disposition = item.status === "approved" ? "sent" : "queued";
        actions.push({
          kind: "email_queued",
          title: item.title,
          detail: `Draft ${draftId}`,
          href: "/queue",
          disposition,
          queueItemId: item.id,
        });
        return JSON.stringify({ success: true, queued: disposition === "queued", itemId: item.id });
      }

      case "get_calendar_connection_status": {
        const calStatus = await calendar.getConnectionStatus(tenantId);
        return JSON.stringify({ connected: calStatus.googlecalendar === "connected", status: calStatus });
      }

      case "mute_thread": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        await inbox.muteThread(tenantId, threadId);
        return JSON.stringify({ success: true, threadId, muted: true });
      }

      case "unmute_thread": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        await inbox.unmuteThread(tenantId, threadId);
        return JSON.stringify({ success: true, threadId, muted: false });
      }

      case "batch_modify_threads": {
        const threadIds = Array.isArray(args.threadIds) ? args.threadIds.map(String) : [];
        if (threadIds.length === 0) return JSON.stringify({ success: false, error: "threadIds is required" });
        const result = await inbox.batchModifyThreads(tenantId, {
          threadIds,
          addLabelIds: Array.isArray(args.addLabelIds) ? args.addLabelIds.map(String) : undefined,
          removeLabelIds: Array.isArray(args.removeLabelIds) ? args.removeLabelIds.map(String) : undefined,
        });
        return JSON.stringify({ success: true, ...result });
      }

      case "search_threads_db": {
        const result = await inbox.searchThreadsDb(tenantId, {
          query: typeof args.query === "string" ? args.query : undefined,
          limit: args.limit != null ? Number(args.limit) : undefined,
        });
        return JSON.stringify(result);
      }

      case "search_messages_db": {
        const result = await inbox.searchMessagesDb(tenantId, {
          query: typeof args.query === "string" ? args.query : undefined,
          from: typeof args.from === "string" ? args.from : undefined,
          limit: args.limit != null ? Number(args.limit) : undefined,
        });
        return JSON.stringify(result);
      }

      case "search_events_db": {
        const result = await calendar.searchEventsDb(tenantId, {
          query: typeof args.query === "string" ? args.query : undefined,
          limit: args.limit != null ? Number(args.limit) : undefined,
        });
        return JSON.stringify(result);
      }

      case "search_calendars_db": {
        const result = await calendar.searchCalendarsDb(tenantId, {
          query: typeof args.query === "string" ? args.query : undefined,
          limit: args.limit != null ? Number(args.limit) : undefined,
        });
        return JSON.stringify(result);
      }

      case "search_drafts_db": {
        const result = await inbox.searchDraftsDb(tenantId, {
          limit: args.limit != null ? Number(args.limit) : undefined,
        });
        return JSON.stringify(result);
      }

      case "search_labels_db": {
        const result = await inbox.searchLabelsDb(tenantId, {
          name: typeof args.name === "string" ? args.name : undefined,
          limit: args.limit != null ? Number(args.limit) : undefined,
        });
        return JSON.stringify(result);
      }

      case "list_messages": {
        const result = await inbox.listMessages(tenantId, {
          maxResults: args.maxResults != null ? Number(args.maxResults) : undefined,
          q: typeof args.q === "string" ? args.q : undefined,
          labelIds: Array.isArray(args.labelIds) ? args.labelIds.map(String) : undefined,
        });
        return JSON.stringify(result);
      }

      case "modify_message": {
        const messageId = String(args.messageId ?? "").trim();
        if (!messageId) return JSON.stringify({ success: false, error: "messageId is required" });
        await inbox.modifyMessage(tenantId, messageId, {
          addLabelIds: Array.isArray(args.addLabelIds) ? args.addLabelIds.map(String) : undefined,
          removeLabelIds: Array.isArray(args.removeLabelIds) ? args.removeLabelIds.map(String) : undefined,
        });
        return JSON.stringify({ success: true, messageId });
      }

      case "untrash_thread": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        await inbox.untrashThread(tenantId, threadId);
        return JSON.stringify({ success: true, threadId, untrashed: true });
      }

      case "update_draft": {
        const draftId = String(args.draftId ?? "").trim();
        const to = String(args.to ?? "").trim();
        const subject = String(args.subject ?? "").trim();
        const body = String(args.body ?? "");
        if (!draftId || !to || !subject) {
          return JSON.stringify({ success: false, error: "draftId, to, and subject are required" });
        }
        const result = await inbox.updateDraft(tenantId, draftId, {
          to, subject, body,
          threadId: typeof args.threadId === "string" ? args.threadId : undefined,
        });
        return JSON.stringify({ success: true, ...result });
      }

      case "delete_thread": {
        const threadId = String(args.threadId ?? "").trim();
        if (!threadId) return JSON.stringify({ success: false, error: "threadId is required" });
        await inbox.deleteThread(tenantId, threadId);
        return JSON.stringify({ success: true, threadId, deleted: true });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  };
}
