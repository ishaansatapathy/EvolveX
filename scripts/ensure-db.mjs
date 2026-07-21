import pg from "pg";

const adminUrl = process.env.DATABASE_ADMIN_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres";
const targetDb = process.env.TARGET_DB ?? "evolvex";

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
const existing = await client.query("SELECT datname FROM pg_database WHERE datname = $1", [targetDb]);
if (!existing.rows.length) {
  await client.query(`CREATE DATABASE ${targetDb}`);
  console.log(`Created database: ${targetDb}`);
} else {
  console.log(`Database already exists: ${targetDb}`);
}
await client.end();
