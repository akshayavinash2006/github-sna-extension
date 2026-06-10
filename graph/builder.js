// graph/builder.js — builds adjacency list from GitHub data
// All network fetches now run in parallel via Promise.all for maximum speed.

export class Graph {
  constructor() {
    this.nodes = new Map();   // login → { login, avatar, url, score }
    this.edges = new Map();   // "A||B" → { source, target, weight, repos[] }
  }

  addNode(user) {
    if (!this.nodes.has(user.login)) {
      this.nodes.set(user.login, {
        login: user.login,
        avatar: user.avatar_url || '',
        url: user.html_url || `https://github.com/${user.login}`,
        score: 0
      });
    }
  }

  addEdge(loginA, loginB, repoName) {
    if (loginA === loginB) return;
    const key = [loginA, loginB].sort().join('||');
    if (!this.edges.has(key)) {
      this.edges.set(key, { source: loginA, target: loginB, weight: 0, repos: [] });
    }
    const e = this.edges.get(key);
    e.weight += 1;
    if (!e.repos.includes(repoName)) e.repos.push(repoName);
  }

  // Return adjacency list { login → Map<login, weight> }
  adjacencyList() {
    const adj = new Map();
    for (const login of this.nodes.keys()) adj.set(login, new Map());
    for (const e of this.edges.values()) {
      adj.get(e.source)?.set(e.target, e.weight);
      adj.get(e.target)?.set(e.source, e.weight);
    }
    return adj;
  }

  toD3() {
    return {
      nodes: Array.from(this.nodes.values()),
      links: Array.from(this.edges.values())
    };
  }

  size() {
    return { nodes: this.nodes.size, edges: this.edges.size };
  }
}

// ─── Stars Graph ─────────────────────────────────────────────────────────────
// All stargazer fetches fire in parallel — previously sequential (N × latency),
// now one round trip (1 × latency) regardless of repo count.

export async function buildGraphFromStars(seedUser, starredRepos, getStargazers, onProgress) {
  const graph = new Graph();
  graph.addNode(seedUser);

  const repos = starredRepos.slice(0, 10); // cap at 10 repos for rate limit safety
  onProgress?.(`Fetching stargazers for ${repos.length} repos in parallel…`);

  // Fire all stargazer requests simultaneously
  let completed = 0;
  const repoResults = await Promise.all(
    repos.map(repo =>
      getStargazers(repo.owner.login, repo.name).then(stargazers => {
        completed++;
        onProgress?.(`Stargazers fetched: ${completed}/${repos.length} repos done…`);
        return { repo, stargazers };
      })
    )
  );

  // 1. Add all stargazers and connect them to the seed user
  for (const { repo, stargazers } of repoResults) {
    for (const gazer of stargazers) {
      graph.addNode(gazer);
      graph.addEdge(seedUser.login, gazer.login, repo.full_name);
    }
  }

  // 2. Identify all candidate co-stargazer edges and compute their weights (number of shared repos)
  const candidateEdges = new Map();
  for (const { repo, stargazers } of repoResults) {
    const logins = stargazers.map(g => g.login).filter(l => l !== seedUser.login);
    for (let i = 0; i < logins.length; i++) {
      const u = logins[i];
      for (let j = i + 1; j < logins.length; j++) {
        const v = logins[j];
        const key = u < v ? `${u}||${v}` : `${v}||${u}`;
        if (!candidateEdges.has(key)) {
          candidateEdges.set(key, { source: u, target: v, weight: 0, repos: [] });
        }
        const edgeObj = candidateEdges.get(key);
        edgeObj.weight += 1;
        if (!edgeObj.repos.includes(repo.full_name)) {
          edgeObj.repos.push(repo.full_name);
        }
      }
    }
  }

  // Union-Find class for Kruskal's algorithm
  class SimpleUnionFind {
    constructor() {
      this.parent = new Map();
    }
    find(x) {
      if (!this.parent.has(x)) {
        this.parent.set(x, x);
        return x;
      }
      if (this.parent.get(x) !== x) {
        this.parent.set(x, this.find(this.parent.get(x)));
      }
      return this.parent.get(x);
    }
    union(x, y) {
      const rx = this.find(x);
      const ry = this.find(y);
      if (rx !== ry) {
        this.parent.set(rx, ry);
        return true;
      }
      return false;
    }
  }

  // 3. Sort candidates by weight (number of shared repos) descending
  const sortedCandidates = Array.from(candidateEdges.values())
    .sort((a, b) => b.weight - a.weight);

  // 4. Run Kruskal's to find Maximum Spanning Forest (MSF), plus add strong thresholded edges
  const uf = new SimpleUnionFind();
  for (const edge of sortedCandidates) {
    const isSpanningEdge = uf.union(edge.source, edge.target);
    // Add the edge if it helps connect components (spanning tree) OR if they share >= 2 repos
    if (isSpanningEdge || edge.weight >= 2) {
      for (const repoName of edge.repos) {
        graph.addEdge(edge.source, edge.target, repoName);
      }
    }
  }

  return graph;
}

// ─── Followers Graph ──────────────────────────────────────────────────────────
// Followers + following fetched simultaneously.
// Cross-connection pass for up to 5 key users also runs in parallel.

export async function buildGraphFromFollowers(seedUser, getFollowers, getFollowing, onProgress) {
  const graph = new Graph();
  graph.addNode(seedUser);

  // Fetch followers AND following simultaneously instead of sequentially
  onProgress?.('Fetching followers and following in parallel…');
  const [followers, following] = await Promise.all([
    getFollowers(seedUser.login),
    getFollowing(seedUser.login)
  ]);

  // Merge into a deduplicated neighbor map
  const neighbors = new Map();
  for (const f of followers) {
    neighbors.set(f.login, { user: f, isFollower: true, isFollowing: false });
  }
  for (const f of following) {
    if (neighbors.has(f.login)) {
      neighbors.get(f.login).isFollowing = true;
    } else {
      neighbors.set(f.login, { user: f, isFollower: false, isFollowing: true });
    }
  }

  // Add all neighbor nodes and edges to the seed
  for (const [login, info] of neighbors) {
    graph.addNode(info.user);
    if (info.isFollower && info.isFollowing) {
      graph.addEdge(seedUser.login, login, 'Mutual Follow');
    } else if (info.isFollower) {
      graph.addEdge(seedUser.login, login, 'Follower');
    } else {
      graph.addEdge(seedUser.login, login, 'Following');
    }
  }

  // Pick up to 5 key nodes (mutual follows first) for cross-connection discovery
  const neighborLogins = Array.from(neighbors.keys());
  const mutualFollows = neighborLogins.filter(
    login => neighbors.get(login).isFollower && neighbors.get(login).isFollowing
  );
  const keyNodes = [
    ...mutualFollows,
    ...neighborLogins.filter(l => !mutualFollows.includes(l))
  ].slice(0, 5);

  // Fetch all key-node following lists in parallel
  onProgress?.(`Fetching cross-connections for ${keyNodes.length} key users in parallel…`);
  const keyFollowings = await Promise.all(
    keyNodes.map(login =>
      getFollowing(login).then(f => ({ login, following: f }))
    )
  );

  // Wire up edges between neighbors who follow each other
  for (const { login: keyLogin, following: keyFollowingList } of keyFollowings) {
    for (const f of keyFollowingList) {
      if (neighbors.has(f.login)) {
        graph.addEdge(keyLogin, f.login, 'Cross Connection');
      }
    }
  }

  return graph;
}

// ─── Contributors Graph ───────────────────────────────────────────────────────
// All contributor fetches fire in parallel across all repos.

export async function buildGraphFromContributors(seedUser, getUserRepos, getContributors, onProgress) {
  const graph = new Graph();
  graph.addNode(seedUser);

  onProgress?.('Fetching user repositories…');
  const repos = await getUserRepos(seedUser.login, 1); // first page only (up to 30)

  const capped = repos.slice(0, 10); // cap at 10 repos
  onProgress?.(`Fetching contributors for ${capped.length} repos in parallel…`);

  // Fire all contributor requests simultaneously
  let completed = 0;
  const repoResults = await Promise.all(
    capped.map(repo =>
      getContributors(repo.owner.login, repo.name).then(contributors => {
        completed++;
        onProgress?.(`Contributors fetched: ${completed}/${capped.length} repos done…`);
        return { repo, contributors };
      })
    )
  );

  // Build graph from collected results
  for (const { repo, contributors } of repoResults) {
    for (const contributor of contributors) {
      graph.addNode(contributor);
      graph.addEdge(seedUser.login, contributor.login, repo.name);
      // Connect co-contributors of the same repo
      for (const other of contributors) {
        if (contributor.login !== other.login) {
          graph.addEdge(contributor.login, other.login, repo.name);
        }
      }
    }
  }

  return graph;
}
