import { runDeployCheck } from "@repo/services/deploy/check";

async function main() {
  const baseUrl = process.argv[2] ?? process.env.BASE_URL ?? process.env.DEPLOY_SMOKE_URL ?? null;
  const result = await runDeployCheck({ baseUrl });

  console.log(`[deploy:check] ${result.summary}`);
  if (result.preflight.errors.length > 0) {
    for (const issue of result.preflight.errors) {
      console.error(`  ERROR ${issue.field}: ${issue.message}`);
    }
  }
  if (result.preflight.warnings.length > 0) {
    for (const issue of result.preflight.warnings) {
      console.warn(`  WARN ${issue.field}: ${issue.message}`);
    }
  }
  if (result.smoke) {
    for (const check of result.smoke.checks) {
      const prefix = check.ok ? "OK" : "FAIL";
      console.log(`  ${prefix} ${check.name}: ${check.message} (${check.durationMs} ms)`);
    }
  }

  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  console.error("[deploy:check] Failed:", error);
  process.exit(1);
});
