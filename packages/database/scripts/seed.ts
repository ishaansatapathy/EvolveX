import "dotenv/config";
import bcrypt from "bcryptjs";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, notLike } from "drizzle-orm";
import { Client } from "pg";

import { usersTable } from "../models/user";
import { threadQueueItemsTable } from "../models/queue-item";
import { threadMailCacheTable } from "../models/mail-cache";
import { DEMO_MAIL_FIXTURES, buildDemoQueueFixtures } from "./demo-seed-data";

const SALT_ROUNDS = 12;
const DEMO_THREAD_PREFIX = "demo-thread-";

async function purgeNonDemoMailCache(db: NodePgDatabase, userId: string) {
  const removed = await db
    .delete(threadMailCacheTable)
    .where(
      and(
        eq(threadMailCacheTable.userId, userId),
        notLike(threadMailCacheTable.threadId, `${DEMO_THREAD_PREFIX}%`),
      ),
    )
    .returning({ id: threadMailCacheTable.id });

  if (removed.length > 0) {
    console.log(`[seed] Removed ${removed.length} non-demo cached inbox thread(s).`);
  }
}

async function purgeCorsairGmailForTenant(client: Client, tenantId: string) {
  const integration = await client.query<{ id: string }>(
    `SELECT id FROM corsair_integrations WHERE name = ANY($1::text[]) LIMIT 1`,
    [["gmail", "@corsair-dev/gmail"]],
  );
  const integrationId = integration.rows[0]?.id;
  if (!integrationId) return;

  const accounts = await client.query<{ id: string }>(
    `SELECT id FROM corsair_accounts WHERE tenant_id = $1 AND integration_id = $2`,
    [tenantId, integrationId],
  );
  const accountIds = accounts.rows.map((row) => row.id);
  if (accountIds.length === 0) return;

  await client.query(`DELETE FROM corsair_entities WHERE account_id = ANY($1::text[])`, [accountIds]);
  await client.query(`DELETE FROM corsair_events WHERE account_id = ANY($1::text[])`, [accountIds]);
  await client.query(`DELETE FROM corsair_accounts WHERE id = ANY($1::text[])`, [accountIds]);
  console.log(`[seed] Cleared Corsair Gmail sync for demo tenant (${accountIds.length} account(s)).`);
}

async function seedDemoMailCache(db: NodePgDatabase, userId: string) {
  for (const fixture of DEMO_MAIL_FIXTURES) {
    const lastMessageAt = new Date(Date.now() - fixture.hoursAgo * 3_600_000);
    const labelIds = ["INBOX", ...(fixture.starred ? ["STARRED"] : [])];
    await db
      .insert(threadMailCacheTable)
      .values({
        id: `${userId}:${fixture.threadId}`,
        userId,
        threadId: fixture.threadId,
        subject: fixture.subject,
        fromName: fixture.fromName,
        fromAddress: fixture.fromAddress,
        snippet: fixture.body,
        lastMessageAt,
        messageCount: 1,
        unread: fixture.unread,
        labelIds,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [threadMailCacheTable.userId, threadMailCacheTable.threadId],
        set: {
          subject: fixture.subject,
          fromName: fixture.fromName,
          fromAddress: fixture.fromAddress,
          snippet: fixture.body,
          lastMessageAt,
          unread: fixture.unread,
          labelIds,
          updatedAt: new Date(),
        },
      });
  }
  console.log(`[seed] Demo mail cache seeded (${DEMO_MAIL_FIXTURES.length} threads).`);
}

async function seedDemoQueueItems(db: NodePgDatabase, userId: string) {
  const fixtures = buildDemoQueueFixtures();
  const existing = await db
    .select({ id: threadQueueItemsTable.id, title: threadQueueItemsTable.title })
    .from(threadQueueItemsTable)
    .where(eq(threadQueueItemsTable.userId, userId));

  const byTitle = new Map(existing.map((row) => [row.title, row.id]));

  for (const fixture of fixtures) {
    const existingId = byTitle.get(fixture.title);
    if (existingId) {
      await db
        .update(threadQueueItemsTable)
        .set({
          kind: fixture.kind,
          preview: fixture.preview,
          payload: fixture.payload,
          status: fixture.status,
          resolvedAt: fixture.status === "pending" ? null : new Date(),
          errorMessage: null,
        })
        .where(eq(threadQueueItemsTable.id, existingId));
      continue;
    }

    await db.insert(threadQueueItemsTable).values({
      userId,
      kind: fixture.kind,
      title: fixture.title,
      preview: fixture.preview,
      payload: fixture.payload,
      status: fixture.status,
      resolvedAt: fixture.status === "pending" ? null : new Date(),
    });
  }
  console.log(`[seed] Demo queue items synced (${fixtures.length} items).`);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const email = process.env.SEED_USER_EMAIL ?? "demo@thread.dev";
  const password = process.env.SEED_DEMO_PASSWORD ?? "DemoPass123!";
  const fullName = "Thread Demo";

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const db = drizzle(client);

  try {
    const existing = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existing.length > 0) {
      const userId = existing[0]!.id;
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      await db
        .update(usersTable)
        .set({ passwordHash, emailVerified: true })
        .where(eq(usersTable.id, userId));
      console.log(`[seed] Demo user already exists: ${email} (password synced from SEED_DEMO_PASSWORD)`);
      await purgeNonDemoMailCache(db, userId);
      await purgeCorsairGmailForTenant(client, userId);
      await seedDemoMailCache(db, userId);
      await seedDemoQueueItems(db, userId);
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const [user] = await db
      .insert(usersTable)
      .values({
        fullName,
        email,
        passwordHash,
        authProvider: "local",
        emailVerified: true,
        verificationToken: null,
        verificationTokenExpire: null,
        role: "user",
        tokenVersion: "0",
        autoApproveEmail: false,
        autoApproveAgentEmail: false,
        autoApproveCalendar: false,
      })
      .returning({ id: usersTable.id, email: usersTable.email });

    console.log(`[seed] Demo user created:`);
    console.log(`       email:    ${user?.email}`);
    console.log(`       password: ${password}`);
    console.log(`       id:       ${user?.id}`);

    if (user?.id) {
      await seedDemoMailCache(db, user.id);
      await seedDemoQueueItems(db, user.id);
    }

    console.log(`[seed] Done.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("[seed] Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
