// algorithms/unionFind.js
// Union-Find (Disjoint Set Union) and Girvan-Newman Community Detection
// Time Complexity: Brandes' algorithm runs in O(V * E) per divisive step.

export class UnionFind {
  constructor(nodes) {
    this.parent = new Map();
    this.rank = new Map();
    this.size = new Map();
    for (const n of nodes) {
      this.parent.set(n, n);
      this.rank.set(n, 0);
      this.size.set(n, 1);
    }
  }

  find(x) {
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)));  // path compression
    }
    return this.parent.get(x);
  }

  union(x, y) {
    const rx = this.find(x), ry = this.find(y);
    if (rx === ry) return false;
    // Union by rank
    if (this.rank.get(rx) < this.rank.get(ry)) {
      this.parent.set(rx, ry);
      this.size.set(ry, this.size.get(ry) + this.size.get(rx));
    } else if (this.rank.get(rx) > this.rank.get(ry)) {
      this.parent.set(ry, rx);
      this.size.set(rx, this.size.get(rx) + this.size.get(ry));
    } else {
      this.parent.set(ry, rx);
      this.rank.set(rx, this.rank.get(rx) + 1);
      this.size.set(rx, this.size.get(rx) + this.size.get(ry));
    }
    return true;
  }

  // Returns Map: root → [members]
  getCommunities() {
    const communities = new Map();
    for (const [node] of this.parent) {
      const root = this.find(node);
      if (!communities.has(root)) communities.set(root, []);
      communities.get(root).push(node);
    }
    return communities;
  }
}

/**
 * Brandes' algorithm for edge betweenness centrality on undirected graphs.
 * Time Complexity: O(V * E)
 */
function computeEdgeBetweenness(nodes, adj) {
  const betweenness = new Map();

  // Initialize betweenness of all current edges to 0
  for (const [u, neighbors] of adj) {
    for (const v of neighbors.keys()) {
      if (u < v) {
        betweenness.set(`${u}||${v}`, 0);
      }
    }
  }

  for (const s of nodes) {
    const S = []; // Stack
    const P = new Map(); // parents list
    for (const n of nodes) P.set(n, []);
    const sigma = new Map(); // path counts
    for (const n of nodes) sigma.set(n, 0);
    sigma.set(s, 1);
    const d = new Map(); // distances
    for (const n of nodes) d.set(n, -1);
    d.set(s, 0);

    const Q = [s];
    while (Q.length > 0) {
      const v = Q.shift();
      S.push(v);
      const neighbors = adj.get(v);
      if (neighbors) {
        for (const w of neighbors.keys()) {
          // Path discovery
          if (d.get(w) < 0) {
            d.set(w, d.get(v) + 1);
            Q.push(w);
          }
          // Path counting
          if (d.get(w) === d.get(v) + 1) {
            sigma.set(w, sigma.get(w) + sigma.get(v));
            P.get(w).push(v);
          }
        }
      }
    }

    const delta = new Map();
    for (const n of nodes) delta.set(n, 0);

    // S returns vertices in order of non-increasing distance from s
    while (S.length > 0) {
      const w = S.pop();
      for (const v of P.get(w)) {
        const c = (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w));
        const key = v < w ? `${v}||${w}` : `${w}||${v}`;
        betweenness.set(key, (betweenness.get(key) || 0) + c);
        delta.set(v, delta.get(v) + c);
      }
    }
  }

  // Divide undirected edge betweenness by 2 (since paths are counted twice)
  for (const [key, val] of betweenness) {
    betweenness.set(key, val / 2);
  }
  return betweenness;
}

/**
 * Calculates modularity Q for a given community partition.
 */
function calculateModularity(partition, originalAdj, m2) {
  if (m2 === 0) return 0;

  // Precompute degrees in original graph
  const degrees = new Map();
  for (const [node, neighbors] of originalAdj) {
    let deg = 0;
    for (const weight of neighbors.values()) {
      deg += weight;
    }
    degrees.set(node, deg);
  }

  let Q = 0;
  for (const community of partition) {
    for (let i = 0; i < community.length; i++) {
      const u = community[i];
      const degU = degrees.get(u) || 0;
      const neighborsU = originalAdj.get(u) || new Map();

      for (let j = 0; j < community.length; j++) {
        const v = community[j];
        const degV = degrees.get(v) || 0;
        const A_uv = neighborsU.get(v) || 0;
        Q += A_uv - (degU * degV) / m2;
      }
    }
  }
  return Q / m2;
}

/**
 * Divisive community detection using the Girvan-Newman algorithm.
 * Maximizes modularity to find the optimal community structure.
 */
export function detectCommunities(graph) {
  const nodes = [...graph.nodes.keys()];
  if (nodes.length === 0) return new Map();
  if (nodes.length === 1) {
    const singleComm = new Map();
    singleComm.set(nodes[0], [nodes[0]]);
    return singleComm;
  }

  // 1. Build original adjacency list with weights
  const originalAdj = new Map();
  for (const n of nodes) originalAdj.set(n, new Map());
  for (const edge of graph.edges.values()) {
    const u = edge.source;
    const v = edge.target;
    const w = edge.weight || 1;
    if (originalAdj.has(u) && originalAdj.has(v)) {
      originalAdj.get(u).set(v, w);
      originalAdj.get(v).set(u, w);
    }
  }

  // Calculate total original weight (m2 = 2 * sum of weights)
  let m2 = 0;
  for (const [node, neighbors] of originalAdj) {
    for (const w of neighbors.values()) {
      m2 += w;
    }
  }

  // Clone adjacency list for the divisive process
  const currentAdj = new Map();
  for (const n of nodes) {
    currentAdj.set(n, new Map(originalAdj.get(n)));
  }

  let bestPartition = null;
  let bestQ = -Infinity;

  // Limit iterations to prevent hanging on huge graphs
  const maxIterations = Math.min(graph.edges.size, 100);

  for (let iter = 0; iter <= maxIterations; iter++) {
    // A. Find connected components of the current graph
    const uf = new UnionFind(nodes);
    for (const [u, neighbors] of currentAdj) {
      for (const v of neighbors.keys()) {
        if (u < v) {
          uf.union(u, v);
        }
      }
    }
    const componentsMap = uf.getCommunities();
    const partition = Array.from(componentsMap.values());

    // B. Calculate modularity for this partition
    const Q = calculateModularity(partition, originalAdj, m2);

    // Update the best partition if modularity is maximized
    if (Q > bestQ) {
      bestQ = Q;
      bestPartition = componentsMap;
    }

    if (iter === maxIterations) break;

    // C. Compute edge betweenness
    const betweenness = computeEdgeBetweenness(nodes, currentAdj);
    if (betweenness.size === 0) break;

    // D. Find the maximum betweenness
    let maxVal = -1;
    for (const val of betweenness.values()) {
      if (val > maxVal) maxVal = val;
    }

    // If max betweenness is 0 or negative, components are completely disconnected
    if (maxVal <= 0) break;

    // E. Remove edges with the maximum betweenness
    let removedAny = false;
    for (const [key, val] of betweenness) {
      if (Math.abs(val - maxVal) < 1e-7) {
        const [u, v] = key.split('||');
        if (currentAdj.has(u) && currentAdj.get(u).has(v)) {
          currentAdj.get(u).delete(v);
          currentAdj.get(v).delete(u);
          removedAny = true;
        }
      }
    }

    if (!removedAny) break;
  }

  return bestPartition || new Map();
}
