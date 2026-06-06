// algorithms/centrality.js
// Degree Centrality — who has the most direct connections?
// Time Complexity: O(V + E)

export function degreeCentrality(graph) {
  const adj = graph.adjacencyList();
  const N = graph.nodes.size - 1 || 1;
  const centrality = new Map();

  for (const [node, neighbors] of adj) {
    centrality.set(node, neighbors.size / N);
  }

  return centrality;
}

// Betweenness centrality (simplified) — how often does a node lie on shortest paths?
// Uses BFS-based approach  O(V * (V + E))
export function betweennessCentrality(graph) {
  const adj = graph.adjacencyList();
  const nodes = [...adj.keys()];
  const betweenness = new Map();
  nodes.forEach(n => betweenness.set(n, 0));

  for (const source of nodes) {
    // BFS from source
    const visited = new Set([source]);
    const queue = [[source, [source]]];

    while (queue.length > 0) {
      const [node, path] = queue.shift();
      for (const [neighbor] of (adj.get(node) || new Map())) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          const newPath = [...path, neighbor];
          queue.push([neighbor, newPath]);
          // All intermediate nodes on this path gain betweenness
          for (let i = 1; i < newPath.length - 1; i++) {
            betweenness.set(newPath[i], betweenness.get(newPath[i]) + 1);
          }
        }
      }
    }
  }

  // Normalize
  const factor = (nodes.length - 1) * (nodes.length - 2);
  if (factor > 0) {
    for (const [n, v] of betweenness) betweenness.set(n, v / factor);
  }

  return betweenness;
}
