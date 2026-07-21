import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";

import { createPgPool } from "./pg";
import * as schema from "./schema";
import * as relations from "./relations";

const pool = createPgPool();

export const db = drizzle(pool, {
  schema: { ...schema, ...relations },
});
export * from "drizzle-orm";
export default db;
