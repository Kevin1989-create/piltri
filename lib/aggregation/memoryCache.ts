/**
 * Minimal in-process cache — a stopgap for when Supabase isn't provisioned
 * yet (see cache.ts). Lives only in this Node process's memory: it resets
 * on every dev-server restart and isn't shared across serverless instances
 * in production, so it's not a substitute for the real Supabase cache. But
 * it immediately speeds up repeat lookups (re-searching the same city,
 * re-dropping a pin near the same spot) during a single dev/testing session
 * without needing any account setup.
 */
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export async function memoize<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = store.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() < hit.expiresAt) {
    return hit.data;
  }
  const data = await compute();
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

/** Writes an entry directly, without calling a `compute` function - used by
 *  /api/admin/seed-random-data to pre-populate this cache with random test
 *  data when Supabase isn't configured, so a later memoize() call for the
 *  same key (e.g. getOrAggregateCityData's fallback path) hits instantly
 *  instead of running the real (slow, live-API) computation. */
export function seed<T>(key: string, data: T, ttlMs: number): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}
