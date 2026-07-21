import { isRedisConfigured } from "./kv-store";

export type SyncPubSubEvent = {
  type: "inbox_updated" | "calendar_updated";
  tenantId: string;
  at: string;
};

const SYNC_CHANNEL = "thread:sync-events";

type SyncListener = (event: SyncPubSubEvent) => void;

const listeners = new Map<string, Set<SyncListener>>();

let bridgeStarted = false;

function fanOutLocal(event: SyncPubSubEvent) {
  for (const listener of listeners.get(event.tenantId) ?? []) {
    try {
      listener(event);
    } catch {
      // Best-effort fan-out.
    }
  }
}

export function subscribeSyncPubSub(tenantId: string, listener: SyncListener): () => void {
  let set = listeners.get(tenantId);
  if (!set) {
    set = new Set();
    listeners.set(tenantId, set);
  }
  set.add(listener);

  return () => {
    set?.delete(listener);
    if (set && set.size === 0) {
      listeners.delete(tenantId);
    }
  };
}

export function publishSyncPubSub(input: { type: SyncPubSubEvent["type"]; tenantId: string }) {
  const event: SyncPubSubEvent = {
    type: input.type,
    tenantId: input.tenantId,
    at: new Date().toISOString(),
  };

  fanOutLocal(event);

  if (isRedisConfigured()) {
    void publishRedis(event).catch(() => undefined);
  }
}

async function publishRedis(event: SyncPubSubEvent) {
  const { createClient } = await import("redis");
  const url = process.env.REDIS_URL?.trim();
  if (!url) return;

  const client = createClient({ url });
  client.on("error", () => undefined);
  await client.connect();
  try {
    await client.publish(SYNC_CHANNEL, JSON.stringify(event));
  } finally {
    await client.quit();
  }
}

export async function startSyncPubSubBridge() {
  if (bridgeStarted || !isRedisConfigured()) return;
  bridgeStarted = true;

  const url = process.env.REDIS_URL?.trim();
  if (!url) return;

  const { createClient } = await import("redis");
  const sub = createClient({ url });
  sub.on("error", () => undefined);
  await sub.connect();
  await sub.subscribe(SYNC_CHANNEL, (message: string) => {
    try {
      const event = JSON.parse(message) as SyncPubSubEvent;
      if (event?.tenantId && event?.type) {
        fanOutLocal(event);
      }
    } catch {
      // Ignore malformed payloads.
    }
  });
}

export function resetSyncPubSubForTests() {
  listeners.clear();
  bridgeStarted = false;
}
