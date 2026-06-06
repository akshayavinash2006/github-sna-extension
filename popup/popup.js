// popup/popup.js
import { setToken, getUser, getStarredRepos, getStargazers, getRateLimit, getFollowers, getFollowing, getUserRepos, getContributors } from '../api/github.js';
import { buildGraphFromStars, buildGraphFromFollowers, buildGraphFromContributors } from '../graph/builder.js';
import { runAlgorithms } from '../algorithms/runner.js';
import { cacheStats, cacheClearAll } from '../api/cache.js';

const usernameEl = document.getElementById('username');
const tokenEl    = document.getElementById('token');
const analyzeBtn = document.getElementById('analyzeBtn');
const statusEl   = document.getElementById('status');
const rateEl     = document.getElementById('rateDisplay');
const openPanelBtn = document.getElementById('openPanel');
const graphTypeEl  = document.getElementById('graphType');
const maxNodesEl   = document.getElementById('maxNodes');
const maxNodesVal  = document.getElementById('maxNodesVal');
const cacheDisplay = document.getElementById('cacheDisplay');
const clearCacheBtn = document.getElementById('clearCacheBtn');

// Keep slider value updated in label
if (maxNodesEl && maxNodesVal) {
  maxNodesEl.addEventListener('input', () => {
    maxNodesVal.textContent = maxNodesEl.value;
  });
}

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = type;
}

// Restore saved settings
chrome.storage.local.get(['gh_token', 'gh_username', 'sna_graph_type', 'sna_max_nodes'], (data) => {
  if (data.gh_token) tokenEl.value = data.gh_token;
  if (data.gh_username) usernameEl.value = data.gh_username;
  if (data.sna_graph_type && graphTypeEl) graphTypeEl.value = data.sna_graph_type;
  if (data.sna_max_nodes && maxNodesEl && maxNodesVal) {
    maxNodesEl.value = data.sna_max_nodes;
    maxNodesVal.textContent = data.sna_max_nodes;
  }
  if (data.gh_token) {
    setToken(data.gh_token);
    updateRateLimit();
  }
  updateCacheStats();
});

async function updateRateLimit() {
  try {
    const rl = await getRateLimit();
    const { remaining, limit } = rl.rate;
    rateEl.textContent = `${remaining} / ${limit}`;
    rateEl.style.color = remaining < 10 ? 'var(--warn)' : 'var(--accent2)';
  } catch { rateEl.textContent = '—'; }
}

async function updateCacheStats() {
  try {
    const stats = await cacheStats();
    cacheDisplay.textContent = stats.count > 0
      ? `${stats.count} entries cached`
      : 'empty';
  } catch { cacheDisplay.textContent = '—'; }
}

if (clearCacheBtn) {
  clearCacheBtn.addEventListener('click', async () => {
    clearCacheBtn.disabled = true;
    clearCacheBtn.textContent = 'Clearing…';
    const cleared = await cacheClearAll();
    setStatus(`Cache cleared (${cleared} entries removed).`, 'ok');
    await updateCacheStats();
    clearCacheBtn.disabled = false;
    clearCacheBtn.textContent = '✕ Clear';
  });
}

function openSidePanel() {
  chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
}

openPanelBtn.addEventListener('click', openSidePanel);

analyzeBtn.addEventListener('click', async () => {
  const username = usernameEl.value.trim();
  const token = tokenEl.value.trim();
  const graphType = graphTypeEl ? graphTypeEl.value : 'stars';
  const maxNodes = maxNodesEl ? parseInt(maxNodesEl.value, 10) : 100;

  if (!username) { setStatus('Enter a GitHub username.', 'error'); return; }

  if (token) {
    setToken(token);
    chrome.storage.local.set({ gh_token: token });
  }
  chrome.storage.local.set({ 
    gh_username: username,
    sna_graph_type: graphType,
    sna_max_nodes: maxNodes
  });

  analyzeBtn.disabled = true;
  setStatus('Fetching user profile…');

  try {
    const user = await getUser(username);
    let graph;

    if (graphType === 'stars') {
      setStatus(`Found @${user.login}. Fetching starred repos…`);
      const starred = await getStarredRepos(username, 2);
      setStatus(`Found ${starred.length} starred repos. Building graph…`);
      graph = await buildGraphFromStars(user, starred, getStargazers, (msg) => setStatus(msg));
    } else if (graphType === 'followers') {
      setStatus(`Found @${user.login}. Building followers network…`);
      graph = await buildGraphFromFollowers(user, getFollowers, getFollowing, (msg) => setStatus(msg));
    } else if (graphType === 'contributors') {
      setStatus(`Found @${user.login}. Fetching repository list…`);
      graph = await buildGraphFromContributors(user, getUserRepos, getContributors, (msg) => setStatus(msg));
    } else {
      throw new Error(`Unknown graph type: ${graphType}`);
    }

    if (!graph || graph.size().nodes <= 1) {
      throw new Error("Could not find any connections to analyze.");
    }

    setStatus('Running algorithms (off-thread)…');

    // Run all three algorithms in a Web Worker so the UI stays responsive
    const { influencers, communities, centrality } = await runAlgorithms(graph, setStatus);

    const communityMap = {};
    let colorIdx = 0;
    for (const [root, members] of communities) {
      for (const m of members) communityMap[m] = colorIdx;
      colorIdx++;
    }

    // Convert full graph to D3 data
    const d3data = graph.toD3();
    d3data.nodes = d3data.nodes.map(n => ({
      ...n,
      community: communityMap[n.login] ?? 0,
      centrality: centrality.get(n.login) ?? 0,
      pagerank: influencers.find(i => i.login === n.login)?.score ?? 0
    }));

    // PRUNING LOGIC: Capping the size of the graph for rendering performance
    const totalNodesCount = d3data.nodes.length;
    const totalEdgesCount = d3data.links.length;
    let prunedNodes = d3data.nodes;
    let prunedLinks = d3data.links;

    if (totalNodesCount > maxNodes) {
      setStatus(`Pruning graph from ${totalNodesCount} to ${maxNodes} nodes…`);
      
      // Sort nodes: seed user ALWAYS has highest score (Infinity) so they are kept.
      // Other nodes sorted by PageRank score descending.
      const nodesWithScore = d3data.nodes.map(n => ({
        node: n,
        score: (n.login.toLowerCase() === username.toLowerCase()) ? Infinity : (n.pagerank || n.centrality || 0)
      }));

      nodesWithScore.sort((a, b) => b.score - a.score);

      prunedNodes = nodesWithScore.slice(0, maxNodes).map(x => x.node);
      const keptLogins = new Set(prunedNodes.map(n => n.login));

      // Filter links to only keep those where both endpoints are in the pruned set
      prunedLinks = d3data.links.filter(link => {
        const source = typeof link.source === 'object' ? link.source.login : link.source;
        const target = typeof link.target === 'object' ? link.target.login : link.target;
        return keptLogins.has(source) && keptLogins.has(target);
      });
    }

    // Filter sidepanel influencers and communities lists to align with the pruned graph
    const prunedLogins = new Set(prunedNodes.map(n => n.login));
    const filteredInfluencers = influencers
      .filter(i => prunedLogins.has(i.login))
      .slice(0, 20); // Keep top 20 visible influencers
    
    const prunedCommunityMap = {};
    for (const [login, commId] of Object.entries(communityMap)) {
      if (prunedLogins.has(login)) {
        prunedCommunityMap[login] = commId;
      }
    }

    const finalD3Data = {
      nodes: prunedNodes,
      links: prunedLinks
    };

    // Save pruned data to storage for side panel
    chrome.storage.local.set({
      sna_graph: finalD3Data,
      sna_influencers: filteredInfluencers,
      sna_communities: prunedCommunityMap,
      sna_seed: username,
      sna_stats: {
        nodes: totalNodesCount,
        edges: totalEdgesCount,
        displayNodes: prunedNodes.length,
        displayEdges: prunedLinks.length,
        communities: communities.size
      }
    }, () => {
      setStatus(`✓ Done! Showing ${prunedNodes.length}/${totalNodesCount} users, ${prunedLinks.length}/${totalEdgesCount} edges.`, 'ok');
      updateRateLimit();
      updateCacheStats();
    });

  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    console.error(err);
  } finally {
    analyzeBtn.disabled = false;
  }
});
