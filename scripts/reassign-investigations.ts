import { eq } from "@repo/database";
import { db } from "@repo/database";
import { investigationsTable, usersTable } from "@repo/database/schema";

const ownerEmail = process.env.INVESTIGATION_OWNER_EMAIL?.trim().toLowerCase();

async function main() {
  if (!ownerEmail) {
    console.error("Set INVESTIGATION_OWNER_EMAIL in .env");
    process.exit(1);
  }

  const [owner] = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.email, ownerEmail))
    .limit(1);

  if (!owner) {
    console.error(
      `No user found for ${ownerEmail}. Sign in once at http://localhost:3000/signin, then rerun this script.`,
    );
    process.exit(1);
  }

  const reassigned = await db
    .update(investigationsTable)
    .set({ userId: owner.id })
    .returning({ id: investigationsTable.id });

  console.log(`Owner: ${owner.email}`);
  console.log(`Reassigned ${reassigned.length} investigation(s) to this account.`);
  if (reassigned.length === 0) {
    console.log("No cases yet — run: pnpm investigation:seed");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
