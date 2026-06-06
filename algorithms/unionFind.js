// algorithms/unionFind.js
// Union-Find (Disjoint Set Union) for community detection
// Time Complexity: O(α(n)) per operation — effectively O(1)

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

export function detectCommunities(graph) {
  const uf = new UnionFind([...graph.nodes.keys()]);
  for (const edge of graph.edges.values()) {
    if (edge.weight >= 1) {   // only union if they share at least 1 repo
      uf.union(edge.source, edge.target);
    }
  }
  return uf.getCommunities();
}
