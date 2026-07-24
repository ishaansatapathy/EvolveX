import { logger } from "@repo/logger";

import { getJiraConfig, type JiraConfig } from "./config";
import { markdownToAdf, type JiraIssueDraft } from "./issue-builder";

export type CreateJiraIssueResult = {
  issueKey: string;
  issueId: string;
  issueUrl: string;
};

function authHeader(config: JiraConfig) {
  const token = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  return `Basic ${token}`;
}

export async function createJiraIssue(
  draft: JiraIssueDraft,
  configOverride?: JiraConfig | null,
): Promise<CreateJiraIssueResult> {
  const config = configOverride ?? getJiraConfig();
  if (!config) {
    throw new Error("Jira is not configured — set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY");
  }

  const response = await fetch(`${config.baseUrl}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: authHeader(config),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        project: { key: config.projectKey },
        summary: draft.summary,
        issuetype: { name: config.issueType },
        priority: { name: draft.priority },
        labels: draft.labels,
        description: markdownToAdf(draft.descriptionMarkdown),
      },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    logger.warn("Jira issue creation failed", {
      status: response.status,
      body: text.slice(0, 400),
    });
    throw new Error(`Jira API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = JSON.parse(text) as { id?: string; key?: string; self?: string };
  const issueKey = json.key ?? "UNKNOWN";
  const issueId = json.id ?? issueKey;
  const issueUrl = `${config.baseUrl}/browse/${issueKey}`;

  return { issueKey, issueId, issueUrl };
}

export { isJiraConfigured, getJiraConfig } from "./config";
