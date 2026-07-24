export type JiraConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
};

export function isJiraConfigured() {
  return Boolean(getJiraConfig());
}

export function getJiraConfig(): JiraConfig | null {
  const baseUrl = process.env.JIRA_BASE_URL?.trim().replace(/\/+$/, "");
  const email = process.env.JIRA_EMAIL?.trim();
  const apiToken = process.env.JIRA_API_TOKEN?.trim();
  const projectKey = process.env.JIRA_PROJECT_KEY?.trim();

  if (!baseUrl || !email || !apiToken || !projectKey) return null;

  return {
    baseUrl,
    email,
    apiToken,
    projectKey,
    issueType: process.env.JIRA_ISSUE_TYPE?.trim() || "Bug",
  };
}

export function mapSeverityToJiraPriority(severity: string | null | undefined) {
  const value = (severity ?? "").toLowerCase();
  if (value === "critical" || value === "high") return "High";
  if (value === "medium" || value === "warning") return "Medium";
  return "Low";
}
