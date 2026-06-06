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

  // Build graph edges from collected results
  for (const { repo, stargazers } of repoResults) {
    for (const gazer of stargazers) {
      graph.addNode(gazer);
      graph.addEdge(seedUser.login, gazer.login, repo.full_name);
      // Connect co-stargazers (people who all starred the same repo)
      for (const other of stargazers) {
        if (gazer.login !== other.login) {
          graph.addEdge(gazer.login, other.login, repo.full_name);
        }
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
