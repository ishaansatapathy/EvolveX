import { desc, eq } from "@repo/database";
import { db } from "@repo/database";
import { investigationsTable } from "@repo/database/schema";
import InvestigationService from "@repo/services/investigation";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function main() {
  const arg = process.argv[2]?.trim();
  let investigationId = arg && isUuid(arg) ? arg : null;

  if (!investigationId) {
    const [latest] = await db
      .select({
        id: investigationsTable.id,
        incidentId: investigationsTable.incidentId,
        status: investigationsTable.status,
      })
      .from(investigationsTable)
      .orderBy(desc(investigationsTable.createdAt))
      .limit(1);

    if (!latest) {
      console.error("[investigation:refresh] No investigations in database. Run pnpm investigation:seed first.");
      process.exit(1);
    }

    investigationId = latest.id;
    console.log(
      `[investigation:refresh] Using latest case ${latest.incidentId ?? latest.id} (pipeline: ${latest.status})`,
    );
  }

  const service = new InvestigationService();
  console.log(`[investigation:refresh] Re-running evidence pipeline for ${investigationId}…`);

  await service.runPipeline(investigationId);

  const [row] = await db
    .select({
      status: investigationsTable.status,
      incidentId: investigationsTable.incidentId,
    })
    .from(investigationsTable)
    .where(eq(investigationsTable.id, investigationId))
    .limit(1);

  console.log(
    `[investigation:refresh] Done — ${row?.incidentId ?? investigationId} is now ${row?.status ?? "unknown"}.`,
  );
  console.log("[investigation:refresh] Open /investigations and refresh the case detail panel.");
}

main().catch((error) => {
  console.error("[investigation:refresh] Failed:", error);
  process.exit(1);
});
