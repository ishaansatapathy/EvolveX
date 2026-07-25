import {
  applyClickHouseMaterializedViews,
  getClickHouseMaterializedViewStatus,
} from "@repo/services/telemetry-intelligence";

async function main() {
  const statusBefore = await getClickHouseMaterializedViewStatus();
  console.log("ClickHouse MV status (before):", statusBefore);

  const result = await applyClickHouseMaterializedViews();
  console.log("Apply result:", result);

  const statusAfter = await getClickHouseMaterializedViewStatus();
  console.log("ClickHouse MV status (after):", statusAfter);

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
