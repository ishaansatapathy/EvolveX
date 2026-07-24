import { formatStructuredEvidenceForPrompt } from "./structured-evidence";
import { formatIncidentNarrativeForPrompt } from "./incident-narrative";
import type { InvestigationNoteDto, InvestigationOsContext } from "./types";
import type { PinpointResult } from "./pinpoint";

export type PostmortemExportInput = {
  shortId: string;
  title: string;
  affectedServices: string[];
  createdAt: string;
  context: InvestigationOsContext;
  notes: InvestigationNoteDto[];
  pinpoint?: PinpointResult | null;
  exportedAt?: string;
};

function formatIso(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString();
  } catch {
    return iso;
  }
}

function formatChangeEvent(type: string, metadata: Record<string, unknown>) {
  if (type === "commit" || type === "deployment") {
    const sha = typeof metadata.sha === "string" ? metadata.sha.slice(0, 7) : null;
    const repo = typeof metadata.repo === "string" ? metadata.repo : null;
    if (repo && sha) return `${repo}@${sha}`;
  }
  return type;
}

function section(title: string, body: string) {
  return `## ${title}\n\n${body.trim()}\n`;
}

/** Builds a shareable incident postmortem markdown doc from real investigation evidence only. */
export function buildPostmortemMarkdown(input: PostmortemExportInput): string {
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const { context } = input;
  const inv = context.investigation;

  const metadataLines = [
    `- **Case ID:** ${input.shortId}`,
    `- **Investigation:** ${input.title}`,
    `- **Pipeline status:** ${inv.status}`,
    `- **Case status:** ${inv.caseStatus ?? "open"}`,
    `- **AI confidence:** ${context.aiConfidence.level} — ${context.aiConfidence.rationale}`,
    `- **Severity:** ${inv.severity ?? "unknown"}`,
    `- **Primary service:** ${inv.primaryService ?? input.affectedServices[0] ?? "unknown"}`,
    `- **Affected services:** ${input.affectedServices.join(", ") || "unknown"}`,
    `- **Opened:** ${formatIso(input.createdAt)}`,
    `- **Investigation started:** ${formatIso(inv.startedAt)}`,
    `- **Investigation completed:** ${formatIso(inv.completedAt)}`,
    `- **Exported:** ${formatIso(exportedAt)}`,
    `- **Evidence completeness:** ${context.evidenceCompleteness.completenessPercent}%`,
  ];

  const executiveSummary =
    context.llmSummary?.markdown ??
    inv.summary ??
    context.evidenceCompleteness.summary ??
    "No AI or rule-based summary available yet.";

  const timelineBlock =
    context.timeline.length === 0
      ? "_No timeline entries collected._"
      : context.timeline
          .map((entry) => {
            const ref = context.evidenceCitations.citations.find(
              (citation) => citation.ref.startsWith("T") && citation.timelineEntryId === entry.id,
            )?.ref;
            const prefix = ref ? `[${ref}] ` : "";
            const source = entry.source ? ` (${entry.source})` : "";
            return `- ${prefix}**${entry.kind}** · ${formatIso(entry.occurredAt)}${source} — ${entry.title} — ${entry.detail}`;
          })
          .join("\n");

  const structuredBlock = formatStructuredEvidenceForPrompt(context.structuredEvidence);

  const completenessBlock = [
    context.evidenceCompleteness.summary,
    "",
    ...context.evidenceCompleteness.sources.map(
      (source) =>
        `- **${source.label}:** ${source.status}${source.configured ? "" : " (integration not configured)"} — ${source.detail}`,
    ),
    context.evidenceCompleteness.missingForConclusion.length
      ? `\n**Missing for conclusion:**\n${context.evidenceCompleteness.missingForConclusion.map((item) => `- ${item}`).join("\n")}`
      : "",
    context.evidenceCompleteness.recommendedNextSteps.length
      ? `\n**Recommended next steps:**\n${context.evidenceCompleteness.recommendedNextSteps.map((item) => `- ${item}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const changeEventsBlock =
    context.changeEvents.length === 0
      ? "_No deploy or cluster change events correlated._"
      : context.changeEvents
          .map(
            (event) =>
              `- **${event.type}** · ${formatIso(event.occurredAt)} · ${formatChangeEvent(event.type, event.metadata)}${event.author ? ` · ${event.author}` : ""}`,
          )
          .join("\n");

  const notesBlock =
    input.notes.length === 0
      ? "_No engineer notes recorded._"
      : input.notes
          .map((note) => `- ${formatIso(note.createdAt)} — ${note.body}`)
          .join("\n");

  let pinpointBlock = "_Pinpoint not available for this case._";
  if (input.pinpoint?.primary) {
    const primary = input.pinpoint.primary;
    pinpointBlock = [
      `- **File:** \`${primary.file}${primary.line > 0 ? `:${primary.line}` : ""}\``,
      `- **Confidence:** ${primary.confidence}`,
      `- **Source:** ${primary.source.replace("_", " ")}`,
      `- **Evidence:** ${primary.evidence}`,
      primary.githubUrl ? `- **GitHub:** ${primary.githubUrl}` : null,
      input.pinpoint.deployCorrelation
        ? `- **Deploy correlation:** ${input.pinpoint.deployCorrelation.repo}@${input.pinpoint.deployCorrelation.sha.slice(0, 7)} (${input.pinpoint.deployCorrelation.url})`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const dependencyBlock =
    context.dependencies.nodes.length === 0
      ? "_No dependency graph captured._"
      : [
          "**Services:**",
          ...context.dependencies.nodes.map(
            (node) =>
              `- ${node.name} · ${node.healthy ? "healthy" : "unhealthy"}${node.latencyMs != null ? ` · ${node.latencyMs}ms` : ""}`,
          ),
          context.dependencies.edges.length ? "\n**Edges:**" : "",
          ...context.dependencies.edges.map(
            (edge) =>
              `- ${edge.source} → ${edge.destination} · ${edge.healthy ? "healthy" : "unhealthy"}`,
          ),
        ].join("\n");

  const evidenceStoreBlock =
    context.evidence.length === 0
      ? "_No evidence store rows._"
      : context.evidence
          .map((row) => {
            const ref = context.evidenceCitations.citations.find(
              (citation) => citation.ref.startsWith("E") && citation.evidenceId === row.id,
            )?.ref;
            const prefix = ref ? `[${ref}] ` : "";
            return `- ${prefix}**${row.type}** · ${formatIso(row.occurredAt)} — ${row.description}`;
          })
          .join("\n");

  const narrativeBlock = formatIncidentNarrativeForPrompt({
    summary: input.context.incidentNarrative.summary,
    beats: input.context.incidentNarrative.beats,
    empty: input.context.incidentNarrative.empty,
  });

  const hypothesesBlock =
    context.rootCauseHypotheses.length === 0
      ? "_No ranked root-cause hypotheses yet._"
      : context.rootCauseHypotheses
          .map(
            (hypothesis, index) =>
              `${index + 1}. **${hypothesis.title}** (${hypothesis.confidence}, ${hypothesis.kind}) — ${hypothesis.rationale}${
                hypothesis.citationRefs.length ? ` · refs: ${hypothesis.citationRefs.join(", ")}` : ""
              }`,
          )
          .join("\n");

  return [
    `# Incident Postmortem · ${input.shortId}`,
    "",
    `_Generated by Evolvex Investigation OS from collected SigNoz, GitHub, and cluster evidence. No synthetic telemetry is included._`,
    "",
    section("Metadata", metadataLines.join("\n")),
    section("Executive summary", executiveSummary),
    section("Incident narrative", narrativeBlock),
    section("Timeline", timelineBlock),
    section("Structured supporting evidence", structuredBlock),
    section("Evidence completeness", completenessBlock),
    section("Change events", changeEventsBlock),
    section("Blast radius", `${context.blastRadius.summary}\n\n${context.blastRadius.impacts.map((item) => `- **${item.service}** (${item.direction}, ${item.impactScore}%): ${item.reasons.join("; ")}`).join("\n")}`),
    section(
      "Cross-service propagation",
      `${context.crossServiceRca.summary}\n\n${context.crossServiceRca.paths.map((path) => `- **${path.services.join(" → ")}** (${path.direction}, ${path.score}%): ${path.summary}`).join("\n")}`,
    ),
    section(
      "Remediation playbook",
      context.remediationPlaybooks.steps.length === 0
        ? context.remediationPlaybooks.summary
        : `${context.remediationPlaybooks.summary}\n\n${context.remediationPlaybooks.steps
            .map(
              (step, index) =>
                `${index + 1}. **${step.title}** (${step.priority}) — ${step.rationale}${
                  step.commands.length ? `\n   \`\`\`\n   ${step.commands.join("\n   ")}\n   \`\`\`` : ""
                }${step.citationRefs.length ? `\n   refs: ${step.citationRefs.join(", ")}` : ""}`,
            )
            .join("\n\n")}`,
    ),
    section("Knowledge graph", `${context.knowledgeGraph.summary}\n\n${context.knowledgeGraph.edges.slice(0, 20).map((edge) => `- ${edge.kind}: ${edge.source} → ${edge.target}`).join("\n")}`),
    section("Root cause hypotheses", hypothesesBlock),
    section("Likely culprit · Pinpoint", pinpointBlock),
    section("Dependency graph", dependencyBlock),
    section("Engineer notes", notesBlock),
    section("Evidence store appendix", evidenceStoreBlock),
    "---",
    "",
    "_Evolvex exports real investigation artifacts only. Regenerate AI summary or collect additional evidence before sharing if completeness is below 100%._",
    "",
  ].join("\n");
}

export function buildPostmortemFilename(shortId: string) {
  const safeId = shortId.replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
  return `evolvex-postmortem-${safeId}.md`;
}
