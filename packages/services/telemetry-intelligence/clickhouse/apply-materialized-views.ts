import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { logger } from "@repo/logger";

import { executeClickHouseQuery } from "./client";

const MV_NAMES = ["evolvex_service_error_summary_mv", "evolvex_top_failing_endpoints_mv"] as const;

function materializedViewSqlPath() {
  const candidates = [
    join(process.cwd(), "packages/services/telemetry-intelligence/clickhouse/materialized-views.sql"),
    join(process.cwd(), "clickhouse/materialized-views.sql"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("materialized-views.sql not found");
}

export function loadMaterializedViewSql() {
  return readFileSync(materializedViewSqlPath(), "utf8");
}

export async function materializedViewExists(name: string) {
  const result = await executeClickHouseQuery(
    `SELECT name FROM system.tables WHERE database = currentDatabase() AND name = {name:String} LIMIT 1`,
    { name },
  );
  return Boolean(result?.rows.length);
}

/** Feature #4 — apply ClickHouse MV templates to self-hosted SigNoz. */
export async function applyClickHouseMaterializedViews() {
  const sql = loadMaterializedViewSql();
  const statements = sql
    .split(";")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0 && !chunk.startsWith("--"));

  const applied: string[] = [];
  const errors: string[] = [];

  for (const statement of statements) {
    const result = await executeClickHouseQuery(`${statement};`);
    if (!result) {
      errors.push(statement.split("\n")[0] ?? "statement");
      continue;
    }
    applied.push(statement.split("\n")[0] ?? "statement");
  }

  const status: Record<string, boolean> = {};
  for (const name of MV_NAMES) {
    status[name] = await materializedViewExists(name);
  }

  logger.info("ClickHouse materialized view apply finished", { applied: applied.length, status });

  return {
    ok: errors.length === 0,
    appliedCount: applied.length,
    errors,
    materializedViews: status,
  };
}

export async function getClickHouseMaterializedViewStatus() {
  const status: Record<string, boolean> = {};
  for (const name of MV_NAMES) {
    status[name] = await materializedViewExists(name);
  }
  return {
    enabled: Boolean(process.env.SIGNOZ_CLICKHOUSE_URL?.trim()),
    materializedViews: status,
    allReady: Object.values(status).every(Boolean),
  };
}
