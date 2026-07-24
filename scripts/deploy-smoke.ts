import { runDeploySmoke } from "@repo/services/deploy/smoke";

async function main() {
  const baseUrl = process.argv[2] ?? process.env.BASE_URL ?? process.env.DEPLOY_SMOKE_URL;
  if (!baseUrl) {
    console.error("[deploy:smoke] Usage: pnpm deploy:smoke <baseUrl>  (or set BASE_URL / DEPLOY_SMOKE_URL)");
    process.exit(1);
  }

  const result = await runDeploySmoke(baseUrl);
  console.log(`[deploy:smoke] ${result.summary} — ${result.baseUrl}`);
  for (const check of result.checks) {
    const icon = check.ok ? "✓" : "✗";
    console.log(`  ${icon} ${check.name} (${check.durationMs} ms) — ${check.message}`);
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error("[deploy:smoke] Failed:", error);
  process.exit(1);
});
