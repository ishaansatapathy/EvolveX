import { createPgClient, getMigrationDatabaseUrl } from "@repo/database/pg";

async function main() {
  const client = await createPgClient(getMigrationDatabaseUrl());
  try {
    const mig = await client.query(
      "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id",
    );
    console.log("Applied count:", mig.rowCount);
    console.log("Last 5:", mig.rows.slice(-5));

    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    console.log("Tables:", tables.rows.map((r) => r.table_name).join(", "));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
