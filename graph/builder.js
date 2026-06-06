// graph/builder.js — builds adjacency list from GitHub data

export class Graph {
  constructor() {
    this.nodes = new Map();   // login → { login, avatar, url, score }
    this.edges = new Map();   // "A||B" → { source, target, weight, repos[] }
  }

  addNode(user) {
    if (!this.nodes.has(user.login)) {
      this.nodes.set(user.login, {
        login: user.login,
        avatar: user.avatar_url || "",
        url: user.html_url || `https://github.com/${user.login}`,
        score: 0
      });
    }
  }

  addEdge(loginA, loginB, repoName) {
    if (loginA === loginB) return;
    const key = [loginA, loginB].sort().join("||");
    if (!this.edges.has(key)) {
      this.edges.set(key, { source: loginA, target: loginB, weight: 0, repos: [] });
    }
    const e = this.edges.get(key);
    e.weight += 1;
    if (!e.repos.includes(repoName)) e.repos.push(repoName);
  }

  // Return adjacency list  {login → Set<login>}
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

// Build graph from starred-repo data
export async function buildGraphFromStars(seedUser, starredRepos, getStargazers, onProgress) {
  const graph = new Graph();
  graph.addNode(seedUser);

  const total = Math.min(starredRepos.length, 10); // cap at 10 repos to stay in rate limits
  for (let i = 0; i < total; i++) {
    const repo = starredRepos[i];
    onProgress?.(`Fetching stargazers for ${repo.name}… (${i + 1}/${total})`);
    const stargazers = await getStargazers(repo.owner.login, repo.name);
    for (const gazer of stargazers) {
      graph.addNode(gazer);
      graph.addEdge(seedUser.login, gazer.login, repo.full_name);
      // Also connect gazers to each other if they share this repo
      for (const other of stargazers) {
        if (gazer.login !== other.login) {
          graph.addEdge(gazer.login, other.login, repo.full_name);
        }
      }
    }
  }
  return graph;
}

// Build graph from followers/following data
export async function buildGraphFromFollowers(seedUser, getFollowers, getFollowing, onProgress) {
  const graph = new Graph();
  graph.addNode(seedUser);

  onProgress?.("Fetching followers…");
  const followers = await getFollowers(seedUser.login);
  
  onProgress?.("Fetching following…");
  const following = await getFollowing(seedUser.login);

  // Combine into a map to deduplicate and keep track of who is who
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

  // Add all neighbor nodes and connect them to seed
  for (const [login, info] of neighbors) {
    graph.addNode(info.user);
    if (info.isFollower && info.isFollowing) {
      graph.addEdge(seedUser.login, login, "Mutual Follow");
    } else if (info.isFollower) {
      graph.addEdge(seedUser.login, login, "Follower");
    } else {
      graph.addEdge(seedUser.login, login, "Following");
    }
  }

  // To build a richer network, fetch the following lists of up to 5 key neighbors
  const neighborLogins = Array.from(neighbors.keys());
  const mutualFollows = neighborLogins.filter(login => neighbors.get(login).isFollower && neighbors.get(login).isFollowing);
  
  // Choose up to 5 nodes to explore connections among neighbors
  const keyNodes = [...mutualFollows, ...neighborLogins.filter(login => !mutualFollows.includes(login))].slice(0, 5);

  for (let i = 0; i < keyNodes.length; i++) {
    const keyLogin = keyNodes[i];
    onProgress?.(`Fetching connections for ${keyLogin}… (${i + 1}/${keyNodes.length})`);
    
    const keyFollowing = await getFollowing(keyLogin);
    for (const f of keyFollowing) {
      // If they follow someone else in our neighbor list, add an edge between them!
      if (neighbors.has(f.login)) {
        graph.addEdge(keyLogin, f.login, "Cross Connection");
      }
    }
  }

  return graph;
}

// Build graph from repository contributors data
export async function buildGraphFromContributors(seedUser, getUserRepos, getContributors, onProgress) {
  const graph = new Graph();
  graph.addNode(seedUser);

  onProgress?.("Fetching user repositories…");
  const repos = await getUserRepos(seedUser.login, 1); // get first page of repos (up to 30)

  // Cap repos at 10 to keep rate limit usage reasonable
  const total = Math.min(repos.length, 10);
  
  for (let i = 0; i < total; i++) {
    const repo = repos[i];
    onProgress?.(`Fetching contributors for ${repo.name}… (${i + 1}/${total})`);
    const contributors = await getContributors(repo.owner.login, repo.name);
    
    for (const contributor of contributors) {
      graph.addNode(contributor);
      graph.addEdge(seedUser.login, contributor.login, repo.name);
      
      // Connect contributors of the same repository to each other
      for (const other of contributors) {
        if (contributor.login !== other.login) {
          graph.addEdge(contributor.login, other.login, repo.name);
        }
      }
    }
  }

  return graph;
}

