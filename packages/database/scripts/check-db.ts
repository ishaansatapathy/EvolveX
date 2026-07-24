import { pingDatabase } from "../health";
import { env } from "../env";
import { getMigrationDatabaseUrl, isNeonDatabase } from "../pg";

async function main() {
  console.log("Evolvex DB check");
  console.log(`  DATABASE_URL host: ${maskHost(env.DATABASE_URL)}`);

  await pingDatabase();
  console.log("  ✓ App connection OK (DATABASE_URL)");

  const migrationUrl = getMigrationDatabaseUrl();
  if (env.DATABASE_URL_UNPOOLED) {
    console.log(`  ✓ Migration URL: ${maskHost(env.DATABASE_URL_UNPOOLED)} (direct)`);
  } else if (isNeonDatabase(migrationUrl) && migrationUrl.includes("-pooler.")) {
    console.warn(
      "  ⚠ Neon pooled URL used for migrations — add DATABASE_URL_UNPOOLED (direct URL from Neon dashboard)",
    );
  } else {
    console.log(`  ✓ Migration URL: ${maskHost(migrationUrl)}`);
  }
}

function maskHost(connectionString: string) {
  try {
    const normalized = connectionString.replace(/^postgres(ql)?:\/\//, "https://");
    const url = new URL(normalized);
    return url.hostname;
  } catch {
    return "(invalid URL)";
  }
}

main().catch((error) => {
  console.error("  ✗ Database check failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
