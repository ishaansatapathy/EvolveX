import { and, desc, eq, sql } from "@repo/database";
import { db } from "@repo/database";
import {
  changeEventsTable,
  investigationEmbeddingsTable,
  investigationMemoryTable,
  investigationNotesTable,
  investigationSummariesTable,
  investigationTimelineEntriesTable,
  investigationsTable,
  type SelectInvestigation,
} from "@repo/database/schema";

import { shortInvestigationId } from "../signoz/webhook-parser";
import { loadInvestigationAccessContext } from "./access-context";
import { buildInvestigationAccessFilter } from "./access-filter";
import { canAccessInvestigation } from "./access";
import {
  buildInvestigationEmbeddingText,
  loadInvestigationEmbedding,
  persistInvestigationEmbedding,
  rankEmbeddingCandidates,
} from "./embeddings";
import { buildRemediationPlaybooks } from "./remediation-playbooks";

export type InvestigationMemoryMatch = {
  investigationId: string;
  shortId: string;
  title: string;
  similarityScore: number;
  matchReasons: string[];
  symptoms: string;
  rootCause: string | null;
  fixApplied: string | null;
  fixOutcome: string;
  durationMs: number | null;
  impactSummary: string | null;
  resolvedAt: string;
  primaryService: string | null;
};

function extractMarkdownSection(markdown: string, heading: string) {
  const regex = new RegExp(`##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
  const match = markdown.match(regex);
  return match?.[1]?.trim() ?? null;
}

function formatDuration(ms: number | null) {
  if (ms == null || ms <= 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr`;
}

function buildSymptoms(row: SelectInvestigation) {
  const parts = [
    row.alertName ? `Alert: ${row.alertName}` : null,
    row.primaryService ? `Service: ${row.primaryService}` : null,
    row.severity ? `Severity: ${row.severity}` : null,
    row.summary,
  ].filter(Boolean);

  return parts.join("\n").trim() || row.title;
}

function scoreHeuristicMemoryMatch(current: SelectInvestigation, candidate: SelectInvestigation) {
  let score = 0;
  const reasons: string[] = [];

  const currentServices = new Set([
    ...(current.affectedServices ?? []),
    ...(current.primaryService ? [current.primaryService] : []),
  ]);
  const candidateServices = new Set([
    ...(candidate.affectedServices ?? []),
    ...(candidate.primaryService ? [candidate.primaryService] : []),
  ]);

  for (const service of currentServices) {
    if (candidateServices.has(service)) {
      score += 40;
      reasons.push(`Same service: ${service}`);
      break;
    }
  }

  if (current.alertName && candidate.alertName && current.alertName === candidate.alertName) {
    score += 35;
    reasons.push(`Same alert: ${candidate.alertName}`);
  }

  if (current.severity && candidate.severity && current.severity === candidate.severity) {
    score += 10;
    reasons.push(`Same severity: ${candidate.severity}`);
  }

  return { score, reasons };
}

export function formatInvestigationMemoryForPrompt(matches: InvestigationMemoryMatch[]) {
  if (matches.length === 0) {
    return "(no prior resolved incidents with comparable symptoms)";
  }

  return matches
    .map((item, index) => {
      const duration = formatDuration(item.durationMs);
      return [
        `### Prior incident ${index + 1}: ${item.shortId} (${item.similarityScore}% match)`,
        `Title: ${item.title}`,
        `Resolved: ${item.resolvedAt}${duration ? ` · Duration: ${duration}` : ""}`,
        `Symptoms:\n${item.symptoms}`,
        item.rootCause ? `Root cause:\n${item.rootCause}` : "Root cause: (not recorded)",
        item.fixApplied ? `Fix applied:\n${item.fixApplied}` : "Fix applied: (not recorded)",
        item.impactSummary ? `Impact: ${item.impactSummary}` : null,
        `Match reasons: ${item.matchReasons.join("; ")}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export async function captureInvestigationMemory(input: {
  investigationId: string;
  ownerUserId?: string | null;
}) {
  const [row] = await db
    .select()
    .from(investigationsTable)
    .where(eq(investigationsTable.id, input.investigationId))
    .limit(1);

  if (!row || row.caseStatus !== "resolved") return;

  const [latestSummary, notes, timeline, changeEvents] = await Promise.all([
    db
      .select()
      .from(investigationSummariesTable)
      .where(eq(investigationSummariesTable.investigationId, input.investigationId))
      .orderBy(desc(investigationSummariesTable.generatedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({ body: investigationNotesTable.body })
      .from(investigationNotesTable)
      .where(eq(investigationNotesTable.investigationId, input.investigationId))
      .orderBy(desc(investigationNotesTable.createdAt))
      .limit(3),
    db
      .select()
      .from(investigationTimelineEntriesTable)
      .where(eq(investigationTimelineEntriesTable.investigationId, input.investigationId)),
    db
      .select()
      .from(changeEventsTable)
      .where(eq(changeEventsTable.investigationId, input.investigationId)),
  ]);

  const rootCause =
    (latestSummary ? extractMarkdownSection(latestSummary.markdown, "Likely cause") : null) ??
    row.summary;

  const resolutionSummary = latestSummary
    ? extractMarkdownSection(latestSummary.markdown, "Recommended next steps")
    : null;

  const noteFix = notes.map((note) => note.body.trim()).find(Boolean) ?? null;

  const mappedTimeline = timeline.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    detail: entry.detail,
    occurredAt: entry.occurredAt.toISOString(),
    source: entry.source,
    sourceRef: null,
  }));

  const mappedChangeEvents = changeEvents.map((event) => ({
    id: event.id,
    type: event.type,
    service: event.service,
    author: event.author,
    occurredAt: event.occurredAt.toISOString(),
    metadata: event.metadata ?? {},
  }));

  const hasDeployEvidence =
    mappedChangeEvents.some((event) => event.type === "commit" || event.type === "deployment") ||
    mappedTimeline.some((entry) => entry.kind === "DEPLOY");

  const playbooks = buildRemediationPlaybooks({
    primaryService: row.primaryService,
    alertKind: null,
    timeline: mappedTimeline,
    changeEvents: mappedChangeEvents,
    evidenceCompleteness: {
      completenessPercent: 100,
      canConclude: true,
      summary: "Resolved investigation",
      missingForConclusion: [],
      recommendedNextSteps: [],
      sources: [],
    },
    crossServiceRca: undefined,
    citationRefByTimelineId: new Map(),
    hasPinpoint: false,
    hasDeployCorrelation: hasDeployEvidence,
    ebpfRecommended: false,
    ebpfCollected: mappedTimeline.some((entry) => entry.kind === "EBPF"),
  });

  const fixApplied =
    noteFix ??
    resolutionSummary ??
    playbooks.steps[0]?.title ??
    null;

  const startedAt = row.startedAt ?? row.createdAt;
  const durationMs = Math.max(0, Date.now() - startedAt.getTime());

  const symptoms = buildSymptoms(row);
  const impactSummary = [
    row.severity ? `Severity ${row.severity}` : null,
    row.primaryService ? `Primary service ${row.primaryService}` : null,
    row.affectedServices?.length ? `Affected ${row.affectedServices.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  await db
    .insert(investigationMemoryTable)
    .values({
      investigationId: input.investigationId,
      organizationId: row.organizationId,
      ownerUserId: input.ownerUserId ?? row.userId,
      symptoms,
      rootCause,
      fixApplied,
      fixOutcome: "resolved",
      durationMs,
      impactSummary: impactSummary || null,
      resolvedAt: new Date(),
      metadata: {
        alertName: row.alertName,
        primaryService: row.primaryService,
        affectedServices: row.affectedServices ?? [],
      },
    })
    .onConflictDoUpdate({
      target: investigationMemoryTable.investigationId,
      set: {
        symptoms,
        rootCause,
        fixApplied,
        fixOutcome: "resolved",
        durationMs,
        impactSummary: impactSummary || null,
        resolvedAt: new Date(),
        metadata: {
          alertName: row.alertName,
          primaryService: row.primaryService,
          affectedServices: row.affectedServices ?? [],
        },
        updatedAt: new Date(),
      },
    });

  void persistInvestigationEmbedding(
    input.investigationId,
    [
      buildInvestigationEmbeddingText({
        title: row.title,
        summary: row.summary,
        alertName: row.alertName,
        primaryService: row.primaryService,
        affectedServices: row.affectedServices,
      }),
      symptoms,
      rootCause ? `Root cause: ${rootCause}` : null,
      fixApplied ? `Fix: ${fixApplied}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function findMemoryByEmbedding(
  current: SelectInvestigation,
  investigationId: string,
  accessFilter: ReturnType<typeof buildInvestigationAccessFilter>,
  limit: number,
): Promise<InvestigationMemoryMatch[] | null> {
  const baseEmbedding = await loadInvestigationEmbedding(investigationId);
  if (!baseEmbedding) return null;

  const rows = await db
    .select({
      memory: investigationMemoryTable,
      investigation: investigationsTable,
      embedding: investigationEmbeddingsTable.embedding,
    })
    .from(investigationMemoryTable)
    .innerJoin(investigationsTable, eq(investigationMemoryTable.investigationId, investigationsTable.id))
    .innerJoin(
      investigationEmbeddingsTable,
      eq(investigationMemoryTable.investigationId, investigationEmbeddingsTable.investigationId),
    )
    .where(
      and(
        accessFilter,
        eq(investigationsTable.caseStatus, "resolved"),
        sql`${investigationsTable.id} <> ${investigationId}`,
      ),
    )
    .orderBy(desc(investigationMemoryTable.resolvedAt))
    .limit(100);

  const ranked = rankEmbeddingCandidates(
    baseEmbedding.embedding,
    rows.map((row) => ({
      investigationId: row.investigation.id,
      embedding: row.embedding,
    })),
    limit,
  );

  if (ranked.length === 0) return null;

  const rowById = new Map(rows.map((row) => [row.investigation.id, row]));

  return ranked
    .map((item) => {
      const row = rowById.get(item.investigationId);
      if (!row) return null;

      const heuristic = scoreHeuristicMemoryMatch(current, row.investigation);
      return {
        investigationId: row.investigation.id,
        shortId: shortInvestigationId(row.investigation.id),
        title: row.investigation.title,
        similarityScore: item.similarityScore,
        matchReasons: [`Semantic similarity ${item.similarityScore}%`, ...heuristic.reasons.slice(0, 2)],
        symptoms: row.memory.symptoms,
        rootCause: row.memory.rootCause,
        fixApplied: row.memory.fixApplied,
        fixOutcome: row.memory.fixOutcome,
        durationMs: row.memory.durationMs,
        impactSummary: row.memory.impactSummary,
        resolvedAt: row.memory.resolvedAt.toISOString(),
        primaryService: row.investigation.primaryService,
      };
    })
    .filter((item): item is InvestigationMemoryMatch => item !== null);
}

/** Finds resolved-case learnings relevant to the active investigation (#25). */
export async function findRelevantInvestigationMemory(
  userId: string,
  investigationId: string,
  limit = 5,
): Promise<InvestigationMemoryMatch[]> {
  const ctx = await loadInvestigationAccessContext(userId);

  const [current] = await db
    .select()
    .from(investigationsTable)
    .where(eq(investigationsTable.id, investigationId))
    .limit(1);

  if (!current || !canAccessInvestigation(current, ctx)) return [];

  const accessFilter = buildInvestigationAccessFilter(ctx);
  const embeddingMatches = await findMemoryByEmbedding(current, investigationId, accessFilter, limit);
  if (embeddingMatches && embeddingMatches.length > 0) {
    return embeddingMatches;
  }

  const rows = await db
    .select({
      memory: investigationMemoryTable,
      investigation: investigationsTable,
    })
    .from(investigationMemoryTable)
    .innerJoin(investigationsTable, eq(investigationMemoryTable.investigationId, investigationsTable.id))
    .where(
      and(
        accessFilter,
        eq(investigationsTable.caseStatus, "resolved"),
        sql`${investigationsTable.id} <> ${investigationId}`,
      ),
    )
    .orderBy(desc(investigationMemoryTable.resolvedAt))
    .limit(100);

  const scored: InvestigationMemoryMatch[] = [];

  for (const row of rows) {
    const { score, reasons } = scoreHeuristicMemoryMatch(current, row.investigation);
    if (score < 35) continue;

    scored.push({
      investigationId: row.investigation.id,
      shortId: shortInvestigationId(row.investigation.id),
      title: row.investigation.title,
      similarityScore: Math.min(100, score),
      matchReasons: reasons,
      symptoms: row.memory.symptoms,
      rootCause: row.memory.rootCause,
      fixApplied: row.memory.fixApplied,
      fixOutcome: row.memory.fixOutcome,
      durationMs: row.memory.durationMs,
      impactSummary: row.memory.impactSummary,
      resolvedAt: row.memory.resolvedAt.toISOString(),
      primaryService: row.investigation.primaryService,
    });
  }

  return scored.sort((a, b) => b.similarityScore - a.similarityScore).slice(0, limit);
}

/** Org-scoped memory lookup for pipeline LLM enrichment (no user context). */
export async function findRelevantInvestigationMemoryForOrganization(
  organizationId: string | null | undefined,
  investigationId: string,
  current: SelectInvestigation,
  limit = 3,
): Promise<InvestigationMemoryMatch[]> {
  const orgFilter = organizationId
    ? eq(investigationsTable.organizationId, organizationId)
    : sql`true`;

  const rows = await db
    .select({
      memory: investigationMemoryTable,
      investigation: investigationsTable,
      embedding: investigationEmbeddingsTable.embedding,
    })
    .from(investigationMemoryTable)
    .innerJoin(investigationsTable, eq(investigationMemoryTable.investigationId, investigationsTable.id))
    .leftJoin(
      investigationEmbeddingsTable,
      eq(investigationMemoryTable.investigationId, investigationEmbeddingsTable.investigationId),
    )
    .where(
      and(
        orgFilter,
        eq(investigationsTable.caseStatus, "resolved"),
        sql`${investigationsTable.id} <> ${investigationId}`,
      ),
    )
    .orderBy(desc(investigationMemoryTable.resolvedAt))
    .limit(100);

  const baseEmbedding = await loadInvestigationEmbedding(investigationId);
  if (baseEmbedding) {
    const withEmbeddings = rows.filter((row) => row.embedding);
    const ranked = rankEmbeddingCandidates(
      baseEmbedding.embedding,
      withEmbeddings.map((row) => ({
        investigationId: row.investigation.id,
        embedding: row.embedding!,
      })),
      limit,
    );

    if (ranked.length > 0) {
      const rowById = new Map(withEmbeddings.map((row) => [row.investigation.id, row]));
      return ranked
        .map((item) => {
          const row = rowById.get(item.investigationId);
          if (!row) return null;
          const heuristic = scoreHeuristicMemoryMatch(current, row.investigation);
          return {
            investigationId: row.investigation.id,
            shortId: shortInvestigationId(row.investigation.id),
            title: row.investigation.title,
            similarityScore: item.similarityScore,
            matchReasons: [`Semantic similarity ${item.similarityScore}%`, ...heuristic.reasons.slice(0, 2)],
            symptoms: row.memory.symptoms,
            rootCause: row.memory.rootCause,
            fixApplied: row.memory.fixApplied,
            fixOutcome: row.memory.fixOutcome,
            durationMs: row.memory.durationMs,
            impactSummary: row.memory.impactSummary,
            resolvedAt: row.memory.resolvedAt.toISOString(),
            primaryService: row.investigation.primaryService,
          };
        })
        .filter((item): item is InvestigationMemoryMatch => item !== null);
    }
  }

  const scored: InvestigationMemoryMatch[] = [];
  for (const row of rows) {
    const { score, reasons } = scoreHeuristicMemoryMatch(current, row.investigation);
    if (score < 35) continue;
    scored.push({
      investigationId: row.investigation.id,
      shortId: shortInvestigationId(row.investigation.id),
      title: row.investigation.title,
      similarityScore: Math.min(100, score),
      matchReasons: reasons,
      symptoms: row.memory.symptoms,
      rootCause: row.memory.rootCause,
      fixApplied: row.memory.fixApplied,
      fixOutcome: row.memory.fixOutcome,
      durationMs: row.memory.durationMs,
      impactSummary: row.memory.impactSummary,
      resolvedAt: row.memory.resolvedAt.toISOString(),
      primaryService: row.investigation.primaryService,
    });
  }

  return scored.sort((a, b) => b.similarityScore - a.similarityScore).slice(0, limit);
}
