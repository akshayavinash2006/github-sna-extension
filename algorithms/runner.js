// algorithms/runner.js
// Unified entry point for running SNA algorithms.
// Tries to run in a Web Worker (non-blocking UI thread) first.
// If the worker fails or isn't supported, falls back to running inline
// on the main thread so the extension always works.

import { getRankedInfluencers } from './pagerank.js';
import { detectCommunities } from './unionFind.js';
import { degreeCentrality } from './centrality.js';

const WORKER_TIMEOUT_MS = 30_000; // 30 seconds max before giving up on worker

/**
 * Run all three SNA algorithms on a Graph object.
 *
 * @param {Graph} graph - A fully built Graph instance
 * @param {Function} onProgress - Optional progress callback (msg: string) => void
 * @returns {{ influencers: Array, communities: Map, centrality: Map }}
 */
export async function runAlgorithms(graph, onProgress) {
  onProgress?.('Running algorithms (off-thread)…');

  try {
    const result = await runInWorker(graph);
    console.log('[runner] ✓ Algorithms completed in Web Worker');
    return result;
  } catch (err) {
    console.warn('[runner] Worker unavailable, falling back to main thread:', err.message);
    onProgress?.('Running algorithms (main thread)…');
    return runInline(graph);
  }
}

// ─── Inline fallback (main thread, blocking) ─────────────────────────────────

function runInline(graph) {
  const influencers = getRankedInfluencers(graph);
  const communities = detectCommunities(graph);
  const centrality  = degreeCentrality(graph);
  return { influencers, communities, centrality };
}

// ─── Web Worker path (non-blocking) ──────────────────────────────────────────

function runInWorker(graph) {
  return new Promise((resolve, reject) => {
    // Build the full extension URL for the worker script
    const workerUrl = chrome.runtime.getURL('algorithms/worker.js');
    const worker = new Worker(workerUrl, { type: 'module' });
    const jobId = Date.now() + Math.random();

    // Safety timeout — terminate worker if it hangs
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Worker timed out after 30s'));
    }, WORKER_TIMEOUT_MS);

    worker.onmessage = ({ data }) => {
      // Ignore messages from other jobs (shouldn't happen, but be safe)
      if (data.jobId !== jobId) return;

      clearTimeout(timeout);
      worker.terminate();

      if (data.type === 'ALGORITHMS_DONE') {
        // Reconstruct Maps from the arrays that crossed the thread boundary
        resolve({
          influencers: data.influencers,                  // already [{login, score}]
          communities: new Map(data.communities),          // [[root, members[]]] → Map
          centrality:  new Map(data.centrality)            // [[login, score]] → Map
        });
      } else {
        reject(new Error(data.error || 'Unknown worker error'));
      }
    };

    worker.onerror = (err) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(err.message || 'Worker script error'));
    };

    // Serialize the Graph's Maps into plain arrays for cross-thread transfer
    worker.postMessage({
      type: 'RUN_ALGORITHMS',
      jobId,
      nodesEntries: [...graph.nodes.entries()],  // [[login, nodeObj], ...]
      edgesEntries: [...graph.edges.entries()]    // [["A||B", edgeObj], ...]
    });
  });
}
