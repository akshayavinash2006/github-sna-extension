// api/db.js — IndexedDB wrapper for GitHub SNA
// Replaces chrome.storage.local for large data (cache + graph history).
// Two object stores:
//   "api_cache"  → TTL-based API response cache
//   "graphs"     → full graph history (every analysis ever run)

const DB_NAME    = 'github-sna-db';
const DB_VERSION = 1;

let _db = null;

// ─── Open / Initialise ───────────────────────────────────────────────────────

export function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // API response cache store
      if (!db.objectStoreNames.contains('api_cache')) {
        const cs = db.createObjectStore('api_cache', { keyPath: 'key' });
        cs.createIndex('ts', 'ts', { unique: false }); // for future TTL sweeps
      }

      // Full graph history store
      if (!db.objectStoreNames.contains('graphs')) {
        const gs = db.createObjectStore('graphs', { keyPath: 'id', autoIncrement: true });
        gs.createIndex('savedAt', 'savedAt', { unique: false });
        gs.createIndex('seed',    'seed',    { unique: false });
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror   = (e) => reject(new Error(`IndexedDB open failed: ${e.target.error}`));
  });
}

// ─── Internal helper ─────────────────────────────────────────────────────────
// Runs a single IDBRequest inside a transaction and resolves with the result
// on tx.oncomplete (guarantees data is durably written before resolving).

async function run(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;

    try {
      const req    = fn(store);
      req.onsuccess = () => { result = req.result; };
      req.onerror   = () => reject(req.error);
    } catch (err) {
      reject(err);
      return;
    }

    tx.oncomplete = () => resolve(result);
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(new Error('Transaction aborted'));
  });
}

// Same as run() but for operations that use getAll() / openCursor() which
// fire onsuccess multiple times. Resolves with the collected array.
async function runAll(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req   = fn(store);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror   = () => reject(req.error);
    tx.onerror    = () => reject(tx.error);
  });
}

// ─── api_cache store ─────────────────────────────────────────────────────────

/** Returns cached data if the key exists and hasn't expired, else null. */
export async function dbCacheGet(key) {
  const entry = await run('api_cache', 'readonly', s => s.get(key));
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) return null; // expired → treat as miss
  return entry.data;
}

/** Store a value under key with the given TTL (ms). */
export async function dbCacheSet(key, data, ttl) {
  return run('api_cache', 'readwrite', s => s.put({ key, data, ts: Date.now(), ttl }));
}

/** Remove one cache entry by key. */
export async function dbCacheDelete(key) {
  return run('api_cache', 'readwrite', s => s.delete(key));
}

/** Count live (non-expired) entries in the cache store. */
export async function dbCacheCount() {
  const all = await runAll('api_cache', 'readonly', s => s.getAll());
  const now = Date.now();
  return all.filter(e => now - e.ts <= e.ttl).length;
}

/** Wipe the entire cache store. Returns number of entries removed. */
export async function dbCacheClearAll() {
  const count = await dbCacheCount();
  await run('api_cache', 'readwrite', s => s.clear());
  return count;
}

// ─── graphs store ─────────────────────────────────────────────────────────────

/**
 * Save a complete graph analysis to history.
 * @param {{ seed, graphType, nodes, links, influencers, communities, stats }} graphData
 * @returns {number} The auto-generated id of the saved record.
 */
export async function saveGraph(graphData) {
  return run('graphs', 'readwrite', s =>
    s.add({ ...graphData, savedAt: Date.now() })
  );
}

/** Load the most recently saved graph (full data). */
export async function getLatestGraph() {
  const all = await runAll('graphs', 'readonly', s => s.getAll());
  if (!all.length) return null;
  return all.sort((a, b) => b.savedAt - a.savedAt)[0];
}

/** Load a specific graph by its auto-increment id (full data). */
export async function getGraphById(id) {
  return run('graphs', 'readonly', s => s.get(id));
}

/**
 * Return metadata for all saved graphs (newest first).
 * Does NOT include full node/link arrays to keep the list lightweight.
 */
export async function getAllGraphHistory() {
  const all = await runAll('graphs', 'readonly', s => s.getAll());
  return all
    .sort((a, b) => b.savedAt - a.savedAt)
    .map(({ id, seed, graphType, savedAt, stats }) => ({ id, seed, graphType, savedAt, stats }));
}

/** Delete a single history entry by id. */
export async function deleteGraphById(id) {
  return run('graphs', 'readwrite', s => s.delete(id));
}

/** Wipe the entire graph history store. */
export async function clearAllGraphs() {
  return run('graphs', 'readwrite', s => s.clear());
}
