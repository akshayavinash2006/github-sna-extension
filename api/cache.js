// api/cache.js — chrome.storage.local based cache with TTL
// Acts as a Redis-like layer: get, set, clear with expiry

const CACHE_PREFIX = 'sna_cache_';

export const TTL_6H  = 6  * 60 * 60 * 1000;  // user profiles (slow-changing)
export const TTL_2H  = 2  * 60 * 60 * 1000;  // followers, repos, stargazers
export const TTL_30M = 30 * 60 * 1000;        // rate limit (very dynamic)

/**
 * Get a cached value by key.
 * Returns the data if it exists and hasn't expired, otherwise null (cache miss).
 */
export async function cacheGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(CACHE_PREFIX + key, (result) => {
      const entry = result[CACHE_PREFIX + key];

      // No entry found → cache miss
      if (!entry) return resolve(null);

      // Entry expired → treat as cache miss
      if (Date.now() - entry.ts > entry.ttl) return resolve(null);

      // Cache hit ✓
      resolve(entry.data);
    });
  });
}

/**
 * Store a value in the cache with a TTL (time-to-live in ms).
 */
export async function cacheSet(key, data, ttl = TTL_2H) {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      [CACHE_PREFIX + key]: {
        data,
        ts: Date.now(),  // timestamp when cached
        ttl              // how long this entry is valid
      }
    }, resolve);
  });
}

/**
 * Remove a single cached entry by key.
 */
export async function cacheDelete(key) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(CACHE_PREFIX + key, resolve);
  });
}

/**
 * Clear ALL cached API entries (keys starting with sna_cache_).
 * Leaves sna_graph, sna_influencers, etc. untouched.
 */
export async function cacheClearAll() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (allItems) => {
      const cacheKeys = Object.keys(allItems).filter(k => k.startsWith(CACHE_PREFIX));
      if (cacheKeys.length === 0) return resolve(0);
      chrome.storage.local.remove(cacheKeys, () => resolve(cacheKeys.length));
    });
  });
}

/**
 * Get stats about what's currently cached.
 * Returns { count, keys[] } for display in the popup.
 */
export async function cacheStats() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (allItems) => {
      const now = Date.now();
      const entries = Object.entries(allItems)
        .filter(([k]) => k.startsWith(CACHE_PREFIX))
        .map(([k, v]) => ({
          key: k.replace(CACHE_PREFIX, ''),
          expired: now - v.ts > v.ttl,
          ageMs: now - v.ts
        }));

      resolve({
        count: entries.filter(e => !e.expired).length,
        total: entries.length,
        keys: entries
      });
    });
  });
}
