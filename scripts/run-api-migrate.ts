import { runMigrations } from "../apps/api/src/migrate";

async function main() {
  console.log("Running API migrations...");
  await runMigrations();
  console.log("API migrations finished");
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
