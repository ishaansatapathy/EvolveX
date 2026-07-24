import { validateDeployEnvironment } from "@repo/services/deploy/preflight";

async function main() {
  const environment = (process.argv[2] as "development" | "staging" | "production" | undefined) ??
    (process.env.NODE_ENV === "production" ? "production" : "development");

  const result = validateDeployEnvironment({ environment });
  console.log(`[deploy:preflight] ${result.summary} (${result.environment})`);

  for (const issue of result.errors) {
    console.log(`  ✗ ${issue.field}: ${issue.message}`);
  }
  for (const issue of result.warnings) {
    console.log(`  ~ ${issue.field}: ${issue.message}`);
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error("[deploy:preflight] Failed:", error);
  process.exit(1);
});
