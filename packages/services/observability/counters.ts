/** Shared counters readable from API metrics and tRPC observability routes. */

import { cacheIncr, cacheGet, isRedisConfigured } from "../cache/kv-store";

const COUNTERS_HASH = "thread:metrics:counters";

const counters = new Map<string, number>();

function counterRedisKey(name: string) {
  return `${COUNTERS_HASH}:${name}`;
}

export function incrementSharedCounter(name: string, by = 1) {
  counters.set(name, (counters.get(name) ?? 0) + by);
  if (isRedisConfigured()) {
    void cacheIncr(counterRedisKey(name), 365 * 24 * 60 * 60 * 1000).catch(() => undefined);
  }
}

export function getSharedCounters(): Record<string, number> {
  return Object.fromEntries(counters.entries());
}

/** Merge in-process counters with Redis-backed totals when configured. */
export async function getSharedCountersMerged(): Promise<Record<string, number>> {
  const merged = { ...getSharedCounters() };

  if (!isRedisConfigured()) {
    return merged;
  }

  for (const name of Object.keys(merged)) {
    const remote = await cacheGet(counterRedisKey(name));
    if (remote) {
      merged[name] = Number.parseInt(remote, 10) || merged[name] || 0;
    }
  }

  return merged;
}

export function resetSharedCountersForTests() {
  counters.clear();
}
