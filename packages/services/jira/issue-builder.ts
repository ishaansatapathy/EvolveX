import type { InvestigationOsContext } from "../investigation/types";
import type { PostmortemExportInput } from "../investigation/postmortem-export";
import { buildPostmortemMarkdown } from "../investigation/postmortem-export";
import { mapSeverityToJiraPriority } from "./config";

export type JiraIssueDraft = {
  summary: string;
  descriptionMarkdown: string;
  priority: string;
  labels: string[];
};

function primaryHypothesisTitle(context: InvestigationOsContext) {
  const primary = context.rootCauseHypotheses.find((item) => item.kind === "primary");
  return primary?.title ?? null;
}

function suggestedFix(context: InvestigationOsContext) {
  const step = context.remediationPlaybooks.steps[0];
  return step ? `${step.title} — ${step.rationale}` : null;
}

/** Feature #48 — map investigation evidence into a Jira issue draft. */
export function buildJiraIssueDraft(input: PostmortemExportInput): JiraIssueDraft {
  const { context } = input;
  const inv = context.investigation;
  const hypothesis = primaryHypothesisTitle(context);
  const fix = suggestedFix(context);

  const summary = hypothesis
    ? `[${input.shortId}] ${hypothesis}`
    : `[${input.shortId}] ${input.title}`;

  const header = [
    `*Evolvex investigation:* ${input.shortId}`,
    `*Primary service:* ${inv.primaryService ?? input.affectedServices[0] ?? "unknown"}`,
    `*Severity:* ${inv.severity ?? "unknown"}`,
    hypothesis ? `*Likely root cause:* ${hypothesis}` : null,
    fix ? `*Suggested fix:* ${fix}` : null,
    "",
    "----",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const body = buildPostmortemMarkdown(input);
  const descriptionMarkdown = `${header}${body}`.slice(0, 30000);

  const labels = [
    "evolvex",
    ...(inv.primaryService ? [inv.primaryService.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 50)] : []),
  ].filter(Boolean);

  return {
    summary: summary.slice(0, 250),
    descriptionMarkdown,
    priority: mapSeverityToJiraPriority(inv.severity),
    labels,
  };
}

export function markdownToAdf(markdown: string) {
  const paragraphs = markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(0, 120);

  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((paragraph) => ({
      type: "paragraph",
      content: [{ type: "text", text: paragraph.slice(0, 4000) }],
    })),
  };
}
