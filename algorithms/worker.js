// algorithms/worker.js — runs SNA algorithms off the main UI thread
// Spawned by algorithms/runner.js. Receives a serialized Graph, runs all
// three algorithms, and posts results back to the caller.

import { Graph } from '../graph/builder.js';
import { getRankedInfluencers } from './pagerank.js';
import { detectCommunities } from './unionFind.js';
import { degreeCentrality } from './centrality.js';

self.onmessage = ({ data }) => {
  if (data.type !== 'RUN_ALGORITHMS') return;

  const { nodesEntries, edgesEntries, jobId } = data;

  try {
    // Reconstruct the Graph object from the serialized Map entries
    // (class instances can't cross the worker boundary, so we rebuild)
    const graph = new Graph();
    graph.nodes = new Map(nodesEntries);
    graph.edges = new Map(edgesEntries);

    // Run all three algorithms
    const influencers = getRankedInfluencers(graph);   // [{login, score}] sorted
    const communities = detectCommunities(graph);       // Map<root, members[]>
    const centrality  = degreeCentrality(graph);        // Map<login, score>

    // Maps can't be transferred directly between threads — convert to arrays
    self.postMessage({
      type: 'ALGORITHMS_DONE',
      jobId,
      influencers,                           // already a plain array
      communities: [...communities.entries()], // [[root, [m1,m2,...]], ...]
      centrality:  [...centrality.entries()]   // [[login, score], ...]
    });

  } catch (err) {
    self.postMessage({
      type: 'ALGORITHMS_ERROR',
      jobId,
      error: err.message
    });
  }
};
