import {
  probeDatabaseConnection,
  probeGithubApiConnection,
  probeOpenAiConnection,
  probeSignozConnection,
} from "@repo/services/integrations/probes";
import { buildIntegrationHealth } from "@repo/services/integrations/status";

const STATUS_ICON: Record<string, string> = {
  ready: "✓",
  partial: "~",
  missing: "✗",
  unavailable: "?",
};

async function main() {
  const [database, signoz, github, openai] = await Promise.all([
    probeDatabaseConnection(),
    probeSignozConnection(),
    probeGithubApiConnection(),
    probeOpenAiConnection(),
  ]);

  const health = buildIntegrationHealth({
    databaseConnected: database.ok,
  });

  const readinessPercent =
    health.totalCount > 0 ? Math.round((health.readyCount / health.totalCount) * 100) : 0;

  console.log("\nEvolvex wiring check\n");
  console.log(`Readiness: ${readinessPercent}% (${health.readyCount}/${health.totalCount} ready)`);
  console.log(`${health.summary}\n`);

  for (const item of health.integrations) {
    const icon = STATUS_ICON[item.status] ?? "?";
    console.log(`${icon} ${item.label.padEnd(18)} ${item.status.padEnd(10)} ${item.detail}`);
    if (item.webhookUrl) {
      console.log(`  webhook: ${item.webhookUrl}`);
    }
  }

  console.log("\nLive probes:");
  console.log(`  Database: ${database.ok ? "ok" : "fail"} — ${database.message}`);
  console.log(`  SigNoz:   ${signoz.ok ? "ok" : "fail"} — ${signoz.message}`);
  console.log(`  GitHub:   ${github.ok ? "ok" : "fail"} — ${github.message}`);
  console.log(`  OpenAI:   ${openai.ok ? "ok" : "fail"} — ${openai.message}`);

  const gaps: string[] = [];
  if (!signoz.ok) gaps.push("Fix SigNoz API (SIGNOZ_CLOUD_URL + SIGNOZ_API_KEY)");
  if (!github.ok) gaps.push("Set GITHUB_TOKEN for pinpoint + deploy correlation");
  if (!process.env.SIGNOZ_WEBHOOK_SECRET?.trim()) {
    gaps.push("Run pnpm wiring:secrets and restart dev server");
  }
  if (!process.env.SIGNOZ_WEBHOOK_PUBLIC_URL?.trim()) {
    gaps.push("Expose webhook (localtunnel) and set SIGNOZ_WEBHOOK_PUBLIC_URL");
  }

  if (gaps.length) {
    console.log("\nRecommended next steps:");
    for (const gap of gaps) {
      console.log(`  • ${gap}`);
    }
  }

  console.log("");
  process.exit(readinessPercent >= 70 ? 0 : 1);
}

main().catch((error) => {
  console.error("[wiring:check] Failed:", error);
  process.exit(1);
});
