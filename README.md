# GitHub SNA — Social Network Analyzer

A Chrome browser extension that maps and analyzes GitHub collaboration networks using graph algorithms. Point it at any GitHub user and it builds an interactive force-directed graph of their social connections, ranking users by influence and detecting communities.

![Manifest Version](https://img.shields.io/badge/Manifest-v3-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

- **Three graph modes** — build networks from Starred Repos, Followers/Following, or Repo Contributors
- **Interactive D3 visualization** — force-directed graph with drag, zoom, pan, and node labels
- **PageRank** — ranks users by influence within the network
- **Community detection** — Union-Find algorithm groups users into clusters, color-coded on the graph
- **Degree & Betweenness Centrality** — measures how connected and "bridging" each node is
- **Shortest path finder** — BFS pathfinding between any two users, with animated neon path highlight
- **Node search** — filter and zoom to any user in the graph
- **User detail card** — click any node to see bio, repo count, followers, and link to GitHub profile
- **In-page profile button** — "SNA Analyze Network" button injected on every GitHub profile page
- **Context menu** — right-click any GitHub link or selected text to trigger analysis
- **API caching** — `chrome.storage.local` based cache with TTL; avoids re-fetching data already pulled
- **Off-thread algorithms** — PageRank, UnionFind, and Centrality run in a Web Worker so the UI never freezes
- **Parallel API fetching** — all repo/stargazer/contributor fetches fire simultaneously via `Promise.all`
- **Rate limit display** — live GitHub API rate limit shown in the popup
- **Cache management** — cache entry count shown in popup with a one-click Clear button

---

## Installation (Developer Mode)

This extension has no build step — load it directly from source.

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **"Load unpacked"**
4. Select the root folder of this repository (the folder containing `manifest.json`)
5. Pin the extension via the puzzle-piece icon in the toolbar

After any code change, go back to `chrome://extensions` and click the **🔄 refresh icon** on the extension card.

---

## Usage

### Method 1 — Popup
Click the extension icon in the toolbar:
- Enter a GitHub username
- Optionally paste a GitHub token (increases rate limit from 60 → 5,000 req/hr)
- Select a graph type
- Adjust max nodes with the slider
- Click **▶ Analyze Network**
- The side panel opens automatically with the rendered graph

### Method 2 — Profile Page Button
Navigate to any GitHub profile (e.g. `github.com/torvalds`). An **"SNA Analyze Network"** button is automatically injected into the profile sidebar. Click it to open the side panel and start analysis for that user.

### Method 3 — Context Menu
On any GitHub page, right-click a profile link or select a username text → **"Analyze GitHub SNA Network"**.

---

## GitHub Token

A token is optional but strongly recommended.

| | No Token | With Token |
|---|---|---|
| Rate limit | 60 req/hr (shared per IP) | 5,000 req/hr |
| Data access | Public data only | Same public data |

**To get a free token:**
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **"Generate new token (classic)"**
3. Give it a name, set an expiry
4. **Leave all scopes unticked** — none are needed for public data
5. Copy the `ghp_...` token and paste it into the popup

Tokens are completely free. No plan upgrade required.

---

## Project Structure

```
github-sna-extension/
│
├── manifest.json              # MV3 extension config
├── background.js              # Service worker — context menus, message hub
├── content.js                 # Injected on github.com — profile button
├── content.css                # Styles for the injected button
│
├── api/
│   ├── github.js              # GitHub REST API wrapper (all calls cache-first)
│   └── cache.js               # chrome.storage.local cache with TTL (Redis-like)
│
├── graph/
│   └── builder.js             # Graph class + 3 graph builders (parallel fetching)
│
├── algorithms/
│   ├── bfs.js                 # BFS shortest path + reachability
│   ├── dijkstra.js            # Weighted shortest path (strength-based)
│   ├── centrality.js          # Degree centrality + Betweenness centrality
│   ├── pagerank.js            # Weighted PageRank (damping=0.85, 50 iterations)
│   ├── unionFind.js           # Union-Find with path compression (community detection)
│   ├── worker.js              # Web Worker — runs algorithms off the main thread
│   └── runner.js              # Dispatcher: tries Worker first, falls back inline
│
├── popup/
│   ├── popup.html             # Toolbar popup UI
│   └── popup.js               # Popup logic — settings, analysis trigger, cache UI
│
├── sidepanel/
│   ├── panel.html             # Side panel UI (tabs, graph canvas, detail card)
│   ├── panel.js               # D3 rendering, interaction, re-analysis from panel
│   └── d3.min.js              # Bundled D3 v7
│
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Architecture

```
User triggers analysis
(popup / profile button / context menu)
        │
        ▼
background.js ──► sets sna_pending_analysis in chrome.storage.local
        │
        ▼
panel.js picks it up
        │
        ├── api/github.js (cache-first)
        │     └── cache.js (chrome.storage.local, TTL-based)
        │           Hit  → return cached data instantly
        │           Miss → fetch from GitHub API → store in cache → return
        │
        ├── graph/builder.js
        │     └── Promise.all (parallel fetches for all repos simultaneously)
        │           Builds Graph { nodes: Map, edges: Map }
        │
        ├── algorithms/runner.js
        │     ├── Spawn Web Worker (algorithms/worker.js)
        │     │     Runs: PageRank + UnionFind + DegreeCentrality (off-thread)
        │     └── Fallback: run inline on main thread if worker unavailable
        │
        ├── Graph pruned by PageRank score to maxNodes limit
        │
        └── D3 force simulation renders interactive graph in side panel
```

---

## Algorithms

| Algorithm | File | Complexity | Purpose |
|---|---|---|---|
| BFS | `algorithms/bfs.js` | O(V + E) | Shortest hop-count path between two users |
| Dijkstra | `algorithms/dijkstra.js` | O((V+E) log V) | Strongest connection path (weighted by shared repos) |
| PageRank | `algorithms/pagerank.js` | O(iter × E) | Influence ranking — who is most "important" in the network |
| Union-Find | `algorithms/unionFind.js` | O(α(n)) ≈ O(1) | Community detection — groups of densely connected users |
| Degree Centrality | `algorithms/centrality.js` | O(V + E) | How many direct connections a node has |
| Betweenness Centrality | `algorithms/centrality.js` | O(V × (V+E)) | How often a node appears on shortest paths ("bridge" score) |

---

## Caching

All GitHub API responses are cached in `chrome.storage.local` with TTL-based expiry:

| Data | Cache Key Format | TTL |
|---|---|---|
| User profile | `sna_cache_user_{login}` | 6 hours |
| Starred repos | `sna_cache_starred_{login}_p{pages}` | 2 hours |
| User repos | `sna_cache_repos_{login}_p{pages}` | 2 hours |
| Stargazers | `sna_cache_stargazers_{owner}_{repo}_p{pages}` | 2 hours |
| Contributors | `sna_cache_contributors_{owner}_{repo}` | 2 hours |
| Followers | `sna_cache_followers_{login}` | 2 hours |
| Following | `sna_cache_following_{login}` | 2 hours |
| Rate limit | *(never cached — always fresh)* | — |

Cache entries are silently skipped on expiry and the API is re-fetched. The popup shows live cache entry count and has a **✕ Clear** button to manually bust the cache.

---

## Performance Notes

- **Parallel fetching** — `buildGraphFromStars` with 10 repos previously took ~5s sequentially. With `Promise.all` all 10 fire simultaneously, reducing it to ~500ms (one round-trip latency).
- **Web Worker** — PageRank (50 iterations over potentially hundreds of nodes) runs off the main thread, keeping the UI fully responsive during computation.
- **Graph pruning** — After running algorithms on the full graph, only the top-N nodes by PageRank are sent to D3 for rendering, controlled by the max nodes slider (20–300).
- **D3 simulation cooldown** — The force simulation runs until nodes stabilize, then stops updating, saving CPU.

---

## Permissions

| Permission | Why |
|---|---|
| `storage` | Persisting settings, graph data, and API cache |
| `sidePanel` | Opening the side panel visualization |
| `windows` | Getting the current window ID to open the side panel in |
| `contextMenus` | "Analyze GitHub SNA Network" right-click menu |
| `host: api.github.com` | Making GitHub API requests |
| `content_scripts: github.com` | Injecting the profile button on GitHub pages |

---

## Development Notes

- No build step, no bundler — pure ES Modules loaded natively by Chrome
- All files use `type="module"` — import/export works everywhere including the Web Worker
- After any file change: `chrome://extensions` → 🔄 refresh the extension card
- Open DevTools on the side panel: right-click the panel → Inspect
- Console logs `[cache HIT]` / `[cache MISS]` for every API call, and `[runner] ✓ Algorithms completed in Web Worker` when the worker succeeds
