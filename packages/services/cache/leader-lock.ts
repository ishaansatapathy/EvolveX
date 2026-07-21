import { cacheGet, cacheSet, cacheSetIfAbsent, isRedisConfigured } from "./kv-store";

const memoryLocks = new Map<string, number>();

function tryMemoryLock(key: string, ttlMs: number): boolean {
  const now = Date.now();
  const existing = memoryLocks.get(key);
  if (existing && existing > now) return false;
  memoryLocks.set(key, now + ttlMs);
  return true;
}

/**
 * Best-effort distributed leader lock. With Redis, only one replica holds the lock.
 * Without Redis, each process uses an in-memory lock (multi-replica deployments
 * should set REDIS_URL or DISABLE_INTEGRATION_RENEWAL on follower pods).
 */
export async function acquireLeaderLock(lockName: string, ttlMs: number): Promise<boolean> {
  const key = `leader:${lockName}`;
  const holder = `pid:${process.pid}`;

  if (!isRedisConfigured()) {
    return tryMemoryLock(key, ttlMs);
  }

  try {
    const current = await cacheGet(key);
    if (current === holder) {
      await cacheSet(key, holder, ttlMs);
      return true;
    }

    const acquired = await cacheSetIfAbsent(key, holder, ttlMs);
    if (acquired) return true;

    const confirmed = await cacheGet(key);
    return confirmed === holder;
  } catch {
    return tryMemoryLock(key, ttlMs);
  }
}
