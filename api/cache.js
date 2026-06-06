// api/cache.js — TTL-based API cache backed by IndexedDB
// Public API is identical to before — only the underlying storage changed.
// chrome.storage.local had a 10 MB hard cap; IndexedDB has no practical limit.

import { dbCacheGet, dbCacheSet, dbCacheDelete, dbCacheClearAll, dbCacheCount } from './db.js';

export const TTL_6H  = 6  * 60 * 60 * 1000;   // user profiles (slow-changing)
export const TTL_2H  = 2  * 60 * 60 * 1000;   // followers, repos, stargazers
export const TTL_30M = 30 * 60 * 1000;         // (available for future use)

/** Get a cached value. Returns null on miss or expiry. */
export async function cacheGet(key) {
  return dbCacheGet(key);
}

/** Store a value with a TTL (ms). */
export async function cacheSet(key, data, ttl = TTL_2H) {
  return dbCacheSet(key, data, ttl);
}

/** Remove a single entry. */
export async function cacheDelete(key) {
  return dbCacheDelete(key);
}

/** Wipe all cache entries. Returns number removed. */
export async function cacheClearAll() {
  return dbCacheClearAll();
}

/** Returns { count } of live (non-expired) entries. */
export async function cacheStats() {
  const count = await dbCacheCount();
  return { count };
}
