// algorithms/dijkstra.js
// Dijkstra's weighted shortest path (by repo-connection strength)
// Time Complexity: O((V + E) log V)

export function dijkstra(graph, start, end) {
  const adj = graph.adjacencyList();
  if (!adj.has(start) || !adj.has(end)) return null;

  // Use negative weights to find STRONGEST path (highest shared repos = closest)
  const dist = new Map();
  const prev = new Map();
  const visited = new Set();

  for (const node of adj.keys()) dist.set(node, Infinity);
  dist.set(start, 0);

  // Simple priority queue using sorted array (adequate for our graph size)
  const pq = [{ node: start, cost: 0 }];

  while (pq.length > 0) {
    pq.sort((a, b) => a.cost - b.cost);
    const { node } = pq.shift();

    if (visited.has(node)) continue;
    visited.add(node);

    if (node === end) break;

    const neighbors = adj.get(node) || new Map();
    for (const [neighbor, weight] of neighbors) {
      if (visited.has(neighbor)) continue;
      // Invert weight so more shared repos = shorter distance
      const edgeCost = 1 / (weight || 1);
      const newDist = dist.get(node) + edgeCost;
      if (newDist < dist.get(neighbor)) {
        dist.set(neighbor, newDist);
        prev.set(neighbor, node);
        pq.push({ node: neighbor, cost: newDist });
      }
    }
  }

  if (dist.get(end) === Infinity) return null;

  // Reconstruct path
  const path = [];
  let curr = end;
  while (curr !== undefined) {
    path.unshift(curr);
    curr = prev.get(curr);
  }

  return { path, strength: (1 / dist.get(end)).toFixed(2) };
}
