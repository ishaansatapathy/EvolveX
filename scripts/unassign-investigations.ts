import { db } from "@repo/database";
import { investigationsTable } from "@repo/database/schema";

async function main() {
  const rows = await db
    .update(investigationsTable)
    .set({ userId: null })
    .returning({ id: investigationsTable.id });

  console.log(`Unassigned ${rows.length} investigation(s) — visible to any signed-in user.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
