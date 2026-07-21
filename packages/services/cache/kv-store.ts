type CacheEntry = { value: string; expiresAt: number };

const memory = new Map<string, CacheEntry>();

function memoryGet(key: string): string | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

function memorySet(key: string, value: string, ttlMs: number) {
  memory.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function memoryIncr(key: string, ttlMs: number): number {
  const current = memoryGet(key);
  const next = current ? Number.parseInt(current, 10) + 1 : 1;
  memorySet(key, String(next), ttlMs);
  return next;
}

type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number; NX?: boolean }): Promise<string | null>;
  del(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
};

function redisUrl() {
  return process.env.REDIS_URL?.trim();
}

let redisClient: RedisClient | null = null;
let redisInit: Promise<RedisClient | null> | null = null;

async function getRedisClient(): Promise<RedisClient | null> {
  const url = redisUrl();
  if (!url) return null;

  if (redisClient) return redisClient;
  if (!redisInit) {
    redisInit = import("redis").then(async ({ createClient }) => {
      const client = createClient({ url });
      client.on("error", () => undefined);
      await client.connect();
      redisClient = client as unknown as RedisClient;
      return redisClient;
    }).catch(() => null);
  }

  return redisInit;
}

export function isRedisConfigured(): boolean {
  return Boolean(redisUrl());
}

export async function cacheIncrDistributed(key: string, ttlMs: number): Promise<number> {
  const redis = await getRedisClient();
  if (!redis) {
    throw new Error("Redis is not configured");
  }

  const count = await redis.incr(key);
  const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
  await redis.expire(key, ttlSec);
  return count;
}

export async function cacheGet(key: string): Promise<string | null> {
  const redis = await getRedisClient();
  if (redis) {
    try {
      return await redis.get(key);
    } catch {
      return memoryGet(key);
    }
  }
  return memoryGet(key);
}

export async function cacheDelete(key: string): Promise<void> {
  memory.delete(key);
  const redis = await getRedisClient();
  if (redis) {
    try {
      await redis.del(key);
    } catch {
      // Best-effort invalidation.
    }
  }
}

export async function cacheSet(key: string, value: string, ttlMs: number): Promise<void> {
  const redis = await getRedisClient();
  if (redis) {
    try {
      const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
      await redis.set(key, value, { EX: ttlSec });
      return;
    } catch {
      memorySet(key, value, ttlMs);
      return;
    }
  }
  memorySet(key, value, ttlMs);
}

export async function cacheSetIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
  const redis = await getRedisClient();
  if (redis) {
    try {
      const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
      const result = await redis.set(key, value, { NX: true, EX: ttlSec });
      return result === "OK";
    } catch {
      return tryMemorySetIfAbsent(key, value, ttlMs);
    }
  }
  return tryMemorySetIfAbsent(key, value, ttlMs);
}

function tryMemorySetIfAbsent(key: string, value: string, ttlMs: number): boolean {
  if (memoryGet(key)) return false;
  memorySet(key, value, ttlMs);
  return true;
}

export async function cacheIncr(key: string, ttlMs: number): Promise<number> {
  const redis = await getRedisClient();
  if (redis) {
    try {
      const count = await redis.incr(key);
      const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
      await redis.expire(key, ttlSec);
      return count;
    } catch {
      return memoryIncr(key, ttlMs);
    }
  }
  return memoryIncr(key, ttlMs);
}

export function clearMemoryCacheForTests() {
  memory.clear();
}
