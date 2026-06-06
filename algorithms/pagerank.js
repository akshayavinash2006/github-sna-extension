// algorithms/pagerank.js
// PageRank — ranks users by influence
// Time Complexity: O(iterations × E)

export function pageRank(graph, dampingFactor = 0.85, iterations = 50) {
  const nodes = [...graph.nodes.keys()];
  const N = nodes.length;
  if (N === 0) return new Map();

  const adj = graph.adjacencyList();
  const scores = new Map();
  const outDegree = new Map();

  // Initialize all scores equally
  nodes.forEach(n => {
    scores.set(n, 1 / N);
    // Weighted out-degree: sum of edge weights for correct probability transition
    const sumWeights = Array.from(adj.get(n)?.values() || []).reduce((sum, w) => sum + w, 0);
    outDegree.set(n, sumWeights || 1);
  });

  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Map();

    for (const node of nodes) {
      let incoming = 0;
      // Sum contributions from all neighbors pointing to this node
      for (const [neighbor, weight] of (adj.get(node) || new Map())) {
        const neighborOut = outDegree.get(neighbor) || 1;
        incoming += (scores.get(neighbor) / neighborOut) * weight;
      }
      newScores.set(node, (1 - dampingFactor) / N + dampingFactor * incoming);
    }

    // Convergence check
    let diff = 0;
    for (const n of nodes) diff += Math.abs(newScores.get(n) - scores.get(n));
    nodes.forEach(n => scores.set(n, newScores.get(n)));
    if (diff < 1e-6) break;
  }

  return scores;
}

// Returns sorted array of {login, score}
export function getRankedInfluencers(graph) {
  const scores = pageRank(graph);
  return [...scores.entries()]
    .map(([login, score]) => ({ login, score }))
    .sort((a, b) => b.score - a.score);
}
