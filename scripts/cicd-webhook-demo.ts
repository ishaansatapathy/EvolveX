/**
 * Simulates a GitHub Actions test failure + retry chain against the local API.
 * Usage: pnpm cicd:webhook-demo
 */
const API_URL = process.env.API_INTERNAL_URL?.trim() || "http://localhost:8000";
const SECRET = process.env.CICD_WEBHOOK_SECRET?.trim() ?? "";

const payloads = [
  {
    action: "completed",
    repository: { full_name: "acme/payments-svc" },
    workflow_job: {
      name: "integration-tests",
      workflow_name: "payments-ci",
      conclusion: "failure",
      status: "completed",
      run_attempt: 1,
      html_url: "https://github.com/acme/payments-svc/actions/runs/123/job/456",
      completed_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    },
  },
  {
    action: "completed",
    repository: { full_name: "acme/payments-svc" },
    workflow_job: {
      name: "integration-tests",
      workflow_name: "payments-ci",
      conclusion: "success",
      status: "completed",
      run_attempt: 2,
      html_url: "https://github.com/acme/payments-svc/actions/runs/123/job/457",
      completed_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    },
  },
  {
    stage: "deploy",
    status: "success",
    repository: "acme/payments-svc",
    service: "payments-svc",
    branch: "main",
    occurredAt: new Date().toISOString(),
    runUrl: "https://github.com/acme/payments-svc/actions/runs/123",
  },
];

async function postEvent(payload: Record<string, unknown>, label: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (SECRET) headers["x-evolvex-cicd-secret"] = SECRET;

  const response = await fetch(`${API_URL.replace(/\/+$/, "")}/webhooks/cicd`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  console.log(`[cicd:webhook-demo] ${label} HTTP ${response.status}`);
  console.log(text);

  if (!response.ok) {
    process.exit(1);
  }
}

async function main() {
  await postEvent(payloads[0]!, "test failure");
  await postEvent(payloads[1]!, "test retry success");
  await postEvent(payloads[2]!, "deploy stage");
}

main().catch((error) => {
  console.error("[cicd:webhook-demo] Failed:", error);
  process.exit(1);
});
