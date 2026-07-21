import pg from "pg";

import { env } from "./env";

/** Neon and other hosted Postgres URLs need SSL. */
export function isNeonDatabase(connectionString: string) {
  return connectionString.includes("neon.tech");
}

export function pgConnectionConfig(connectionString: string): pg.ClientConfig {
  const config: pg.ClientConfig = { connectionString };

  if (
    isNeonDatabase(connectionString) ||
    /sslmode=(require|verify-full|verify-ca)/i.test(connectionString)
  ) {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}

/** Prefer Neon direct (non-pooler) URL for drizzle-kit / journal migrations. */
export function getMigrationDatabaseUrl() {
  return env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
}

export function createPgPool(connectionString = env.DATABASE_URL) {
  return new pg.Pool({
    ...pgConnectionConfig(connectionString),
    max: isNeonDatabase(connectionString) ? 5 : 10,
  });
}

export async function createPgClient(connectionString?: string) {
  const url = connectionString ?? env.DATABASE_URL;
  const client = new pg.Client(pgConnectionConfig(url));
  await client.connect();
  return client;
}
