// sidepanel/panel.js — render and interact with graph
import { getUser, getStarredRepos, getStargazers, getRateLimit, getFollowers, getFollowing, getUserRepos, getContributors } from '../api/github.js';
import { buildGraphFromStars, buildGraphFromFollowers, buildGraphFromContributors } from '../graph/builder.js';
import { getRankedInfluencers } from '../algorithms/pagerank.js';
import { detectCommunities } from '../algorithms/unionFind.js';
import { degreeCentrality } from '../algorithms/centrality.js';

let graph = null;
let influencers = [];
let communities = {};
let seed = '';
let stats = {};
let currentAlgorithm = 'pagerank';

const COLORS = [
  '#39d353', '#58a6ff', '#e3b341', '#f78166', '#d29922',
  '#79c0ff', '#56d364', '#b1baf8', '#ffa657', '#ff7b72'
];

// DOM Elements
const graphWrap = document.getElementById('graph-wrap');
const emptySt = document.getElementById('emptyState');
const graphSvg = document.getElementById('graph-svg');
const seedBadge = document.getElementById('seedBadge');
const statNodes = document.getElementById('statNodes');
const statEdges = document.getElementById('statEdges');
const statComm = document.getElementById('statComm');
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');
const statusBar = document.getElementById('status-bar');

// Details Card DOM Elements
const detailCard = document.getElementById('detailCard');
const detailAvatar = document.getElementById('detailAvatar');
const detailLogin = document.getElementById('detailLogin');
const detailName = document.getElementById('detailName');
const detailBio = document.getElementById('detailBio');
const detailRepos = document.getElementById('detailRepos');
const detailFollowers = document.getElementById('detailFollowers');
const detailGithubLink = document.getElementById('detailGithubLink');
const detailAnalyzeBtn = document.getElementById('detailAnalyzeBtn');
const closeDetail = document.getElementById('closeDetail');

let currentDetailRequest = null;

// Loads data from storage and initializes
function loadGraphData() {
  chrome.storage.local.get(
    ['sna_graph', 'sna_influencers', 'sna_communities', 'sna_seed', 'sna_stats'],
    (data) => {
      console.log('Storage data loaded:', { 
        hasGraph: !!data.sna_graph,
        graphNodes: data.sna_graph?.nodes?.length,
        hasInfluencers: !!data.sna_influencers,
        seed: data.sna_seed
      });

      if (data.sna_graph && data.sna_graph.nodes && data.sna_graph.nodes.length > 0) {
        graph = data.sna_graph;
        influencers = data.sna_influencers || [];
        communities = data.sna_communities || {};
        seed = data.sna_seed || '';
        stats = data.sna_stats || {};

        seedBadge.textContent = seed || '—';
        if (stats.displayNodes && stats.displayNodes < stats.nodes) {
          statNodes.textContent = `${stats.displayNodes}/${stats.nodes}`;
        } else {
          statNodes.textContent = stats.nodes || graph.nodes.length;
        }

        if (stats.displayEdges && stats.displayEdges < stats.edges) {
          statEdges.textContent = `${stats.displayEdges}/${stats.edges}`;
        } else {
          statEdges.textContent = stats.edges || graph.links.length;
        }

        statComm.textContent = stats.communities || 0;

        emptySt.style.display = 'none';
        graphSvg.style.display = 'block';

        console.log('Rendering graph...');
        try {
          renderGraph();
          renderInfluencers();
          renderCommunities();
          const nodesStr = stats.displayNodes && stats.displayNodes < stats.nodes 
            ? `${stats.displayNodes}/${stats.nodes}` 
            : (stats.nodes || graph.nodes.length);
          const edgesStr = stats.displayEdges && stats.displayEdges < stats.edges 
            ? `${stats.displayEdges}/${stats.edges}` 
            : (stats.edges || graph.links.length);
          updateStatus(`✓ Graph loaded: ${nodesStr} users, ${edgesStr} edges.`, 'ok');
        } catch (err) {
          console.error('Error rendering graph:', err);
          updateStatus(`Error rendering graph: ${err.message}`, 'err');
        }
      } else {
        console.log('No graph data found in storage');
        emptySt.style.display = 'flex';
        graphSvg.style.display = 'none';
        updateStatus('No graph data. Run an analysis in popup or profile.', '');
      }
    }
  );
}

// Render graph with D3
function renderGraph() {
  if (!graph || !graph.nodes) {
    console.error('Invalid graph data:', graph);
    return;
  }

  const width = graphWrap.clientWidth;
  const height = graphWrap.clientHeight;
  
  console.log(`Rendering graph with dimensions: ${width}x${height}, nodes: ${graph.nodes.length}, links: ${graph.links.length}`);

  if (width <= 0 || height <= 0) {
    console.warn('Invalid SVG dimensions, retrying...');
    setTimeout(renderGraph, 200);
    return;
  }

  // Clear existing
  graphSvg.innerHTML = '';

  // Create container group
  const svg = d3.select('#graph-svg');
  svg.attr('width', width).attr('height', height);

  // Zoom behavior
  const g = svg.append('g');
  const zoom = d3.zoom().on('zoom', (e) => {
    g.attr('transform', e.transform);
  });
  svg.call(zoom);
  
  // Save zoom for controls
  window._zoom = zoom;

  // Simulation
  const simulation = d3.forceSimulation(graph.nodes)
    .force('link', d3.forceLink(graph.links)
      .id(d => d.login)
      .distance(d => 50 / Math.max(d.weight, 1))
      .strength(0.3))
    .force('charge', d3.forceManyBody().strength(-400))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide(25));

  // Links
  const link = g.append('g')
    .selectAll('line')
    .data(graph.links)
    .join('line')
    .attr('stroke', '#30363d')
    .attr('stroke-width', d => Math.min(d.weight * 2, 8))
    .attr('opacity', 0.6);

  // Nodes
  const node = g.append('g')
    .selectAll('circle')
    .data(graph.nodes)
    .join('circle')
    .attr('r', d => {
      if (d.login.toLowerCase() === seed.toLowerCase()) return 18;
      const pr = d.pagerank || 0;
      return 6 + pr * 20;
    })
    .attr('fill', d => {
      const comm = communities[d.login] ?? 0;
      return COLORS[comm % COLORS.length];
    })
    .attr('stroke', '#0d1117')
    .attr('stroke-width', 2)
    .attr('opacity', 0.85)
    .call(d3.drag()
      .on('start', dragStarted)
      .on('drag', dragged)
      .on('end', dragEnded))
    .on('mouseover', (e, d) => showTooltip(e, d))
    .on('mouseout', hideTooltip)
    .on('click', (e, d) => {
      selectNode(d.login);
    });

  // Labels
  const labels = g.append('g')
    .selectAll('text')
    .data(graph.nodes)
    .join('text')
    .attr('font-family', 'Space Mono, monospace')
    .attr('font-size', '9px')
    .attr('text-anchor', 'middle')
    .attr('dy', '.3em')
    .attr('fill', '#e6edf3')
    .attr('pointer-events', 'none')
    .text(d => d.login.length > 12 ? d.login.slice(0, 10) + '..' : d.login)
    .attr('opacity', 0.4);

  // Update positions on tick
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);
    node
      .attr('cx', d => d.x)
      .attr('cy', d => d.y);
    labels
      .attr('x', d => d.x)
      .attr('y', d => d.y);
  });

  // Save simulation for later
  window._simulation = simulation;
  window._nodeElements = node;
  window._linkElements = link;

  // Add legend
  renderLegend();
  
  console.log('Graph rendered successfully');
}

// Render legend for communities
function renderLegend() {
  const uniqueComms = new Set(Object.values(communities));
  if (uniqueComms.size <= 1) return;

  const legend = document.getElementById('legend');
  const items = document.getElementById('legend-items');
  items.innerHTML = '';

  let idx = 0;
  for (const comm of Array.from(uniqueComms).sort((a, b) => a - b)) {
    const row = document.createElement('div');
    row.className = 'legend-row';
    const dot = document.createElement('div');
    dot.className = 'legend-dot';
    dot.style.backgroundColor = COLORS[comm % COLORS.length];
    const label = document.createElement('span');
    label.textContent = `Community ${comm + 1}`;
    row.appendChild(dot);
    row.appendChild(label);
    items.appendChild(row);
  }
  legend.style.display = 'block';
}

// Show tooltip on hover
function showTooltip(e, d) {
  const tooltip = document.getElementById('tooltip');
  const centrality = d.centrality || 0;
  const pr = d.pagerank || 0;
  tooltip.innerHTML = `
    <div class="tooltip-name">${d.login}</div>
    <div class="tooltip-row"><strong>Centrality:</strong> ${centrality.toFixed(2)}</div>
    <div class="tooltip-row"><strong>PageRank:</strong> ${pr.toFixed(4)}</div>
  `;
  tooltip.style.left = e.pageX + 10 + 'px';
  tooltip.style.top = e.pageY + 10 + 'px';
  tooltip.classList.add('visible');
}

function hideTooltip() {
  const tooltip = document.getElementById('tooltip');
  tooltip.classList.remove('visible');
}

// Select node, highlight it, and show details card
async function selectNode(login) {
  if (!window._nodeElements) return;

  window._nodeElements
    .attr('opacity', d => d.login.toLowerCase() === login.toLowerCase() ? 1 : 0.25)
    .attr('stroke-width', d => d.login.toLowerCase() === login.toLowerCase() ? 3 : 2)
    .attr('stroke', d => d.login.toLowerCase() === login.toLowerCase() ? 'var(--accent2)' : '#0d1117');

  window._linkElements
    .attr('opacity', d => {
      const s = typeof d.source === 'object' ? d.source.login : d.source;
      const t = typeof d.target === 'object' ? d.target.login : d.target;
      return (s.toLowerCase() === login.toLowerCase() || t.toLowerCase() === login.toLowerCase()) ? 0.85 : 0.1;
    })
    .classed('active-path-link', false);

  showDetailsCard(login);
}

// Fetch user profile on demand and display detail card
async function showDetailsCard(login) {
  if (!detailCard) return;

  const node = graph.nodes.find(n => n.login.toLowerCase() === login.toLowerCase());
  if (!node) return;

  detailCard.style.display = 'flex';
  detailAvatar.src = node.avatar || '';
  detailLogin.textContent = `@${node.login}`;
  detailName.textContent = '—';
  detailBio.textContent = 'Loading profile details...';
  detailRepos.textContent = '—';
  detailFollowers.textContent = '—';
  detailGithubLink.href = node.url || `https://github.com/${node.login}`;
  
  detailAnalyzeBtn.onclick = () => {
    chrome.storage.local.get(['sna_graph_type', 'sna_max_nodes'], (settings) => {
      const graphType = settings.sna_graph_type || 'stars';
      const maxNodes = settings.sna_max_nodes || 100;
      runAnalysis(node.login, graphType, maxNodes);
    });
  };

  currentDetailRequest = login;

  try {
    const userDetails = await getUser(login);
    if (currentDetailRequest === login) {
      detailName.textContent = userDetails.name || 'No public name';
      detailBio.textContent = userDetails.bio || 'No public bio listed.';
      detailRepos.textContent = userDetails.public_repos ?? 0;
      detailFollowers.textContent = userDetails.followers ?? 0;
    }
  } catch (err) {
    console.error("Failed to load user details card:", err);
    if (currentDetailRequest === login) {
      detailBio.textContent = 'Failed to load bio details from GitHub API.';
    }
  }
}

// Zoom / pan SVG to a specific node coordinates
function zoomToNode(node) {
  if (!node || !window._zoom) return;
  const svg = d3.select('#graph-svg');
  const width = graphWrap.clientWidth;
  const height = graphWrap.clientHeight;
  
  svg.transition().duration(750).call(
    window._zoom.transform,
    d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(1.5)
      .translate(-node.x, -node.y)
  );
}

// Drag functions
function dragStarted(e, d) {
  if (!e.active) window._simulation.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(e, d) {
  d.fx = e.x;
  d.fy = e.y;
}

function dragEnded(e, d) {
  if (!e.active) window._simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

// Render influencers tab
function renderInfluencers() {
  const content = document.querySelector('.tab-content.influencers');
  if (!content) {
    console.warn('Influencers tab content not found');
    return;
  }

  content.innerHTML = '';
  console.log('Rendering influencers:', influencers.length);
  
  if (!influencers.length) {
    content.innerHTML = '<div class="empty"><div class="empty-text">No influencers</div></div>';
    return;
  }

  influencers.forEach((inf, idx) => {
    const item = document.createElement('div');
    item.className = 'influencer-item';
    item.innerHTML = `
      <div class="rank">${idx + 1}</div>
      <img class="avatar" src="${inf.avatar}" onerror="this.src='data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2224%22%20height=%2224%22%20viewBox=%220%200%2024%2024%22%3E%3Crect%20fill=%22%23161b22%22%20width=%2224%22%20height=%2224%22/%3E%3C/svg%3E'"/>
      <div class="inf-info">
        <div class="inf-login">${inf.login}</div>
        <div class="score-bar-wrap"><div class="score-bar" style="width:${Math.min(inf.score * 100, 100)}%"></div></div>
      </div>
    `;
    item.addEventListener('click', () => {
      selectNode(inf.login);
      const matchedNode = graph.nodes.find(n => n.login.toLowerCase() === inf.login.toLowerCase());
      if (matchedNode) zoomToNode(matchedNode);
    });
    content.appendChild(item);
  });
}

// Render communities tab
function renderCommunities() {
  const content = document.querySelector('.tab-content.communities');
  if (!content) {
    console.warn('Communities tab content not found');
    return;
  }

  content.innerHTML = '';
  const commGroups = new Map();
  
  for (const [login, comm] of Object.entries(communities)) {
    if (!commGroups.has(comm)) commGroups.set(comm, []);
    commGroups.get(comm).push(login);
  }

  console.log('Rendering communities:', commGroups.size);

  if (commGroups.size === 0) {
    content.innerHTML = '<div class="empty"><div class="empty-text">No communities</div></div>';
    return;
  }

  commGroups.forEach((members, idx) => {
    const card = document.createElement('div');
    card.className = 'community-card';
    const title = document.createElement('div');
    title.className = 'community-title';
    const dot = document.createElement('div');
    dot.className = 'community-dot';
    dot.style.backgroundColor = COLORS[idx % COLORS.length];
    title.appendChild(dot);
    const label = document.createElement('span');
    label.textContent = `Community ${idx + 1} (${members.length})`;
    title.appendChild(label);
    card.appendChild(title);

    members.slice(0, 10).forEach(login => {
      const chip = document.createElement('div');
      chip.className = 'member-chip';
      chip.textContent = login;
      chip.addEventListener('click', () => {
        selectNode(login);
        const matchedNode = graph.nodes.find(n => n.login.toLowerCase() === login.toLowerCase());
        if (matchedNode) zoomToNode(matchedNode);
      });
      card.appendChild(chip);
    });

    if (members.length > 10) {
      const more = document.createElement('div');
      more.className = 'member-chip';
      more.style.opacity = '0.6';
      more.textContent = `+${members.length - 10} more`;
      card.appendChild(more);
    }

    content.appendChild(card);
  });
}

// Render paths tab (Dijkstra)
function renderPathsTab() {
  const findBtn = document.getElementById('findPathBtn');
  if (!findBtn) return;
  
  // Set up event listener if not already done
  if (!findBtn.hasAttribute('data-listener-set')) {
    findBtn.addEventListener('click', findPath);
    findBtn.setAttribute('data-listener-set', 'true');
  }
}

function findPath() {
  const startEl = document.getElementById('pathStart');
  const endEl = document.getElementById('pathEnd');
  const start = startEl.value.trim().toLowerCase();
  const end = endEl.value.trim().toLowerCase();
  const result = document.getElementById('path-result');

  if (!start || !end) {
    result.innerHTML = '<div style="color:var(--warn)">Enter both usernames</div>';
    return;
  }

  if (!graph || !graph.nodes) {
    result.innerHTML = '<div style="color:var(--warn)">No graph loaded</div>';
    return;
  }

  // Build adjacency list from graph data
  const adj = new Map();
  for (const node of graph.nodes) {
    adj.set(node.login, new Map());
  }
  for (const link of graph.links) {
    const source = typeof link.source === 'object' ? link.source.login : link.source;
    const target = typeof link.target === 'object' ? link.target.login : link.target;
    if (adj.has(source) && adj.has(target)) {
      adj.get(source).set(target, (adj.get(source).get(target) || 0) + (link.weight || 1));
      adj.get(target).set(source, (adj.get(target).get(source) || 0) + (link.weight || 1));
    }
  }

  // Simple BFS for shortest path
  function bfsPath(start, end) {
    if (start === end) return [start];
    
    // Find closest keys case-insensitively
    const keys = Array.from(adj.keys());
    const startReal = keys.find(k => k.toLowerCase() === start);
    const endReal = keys.find(k => k.toLowerCase() === end);
    
    if (!startReal || !endReal) return null;
    
    const visited = new Set([startReal]);
    const queue = [[startReal, [startReal]]];
    
    while (queue.length > 0) {
      const [node, path] = queue.shift();
      for (const neighbor of adj.get(node).keys()) {
        if (neighbor === endReal) return [...path, neighbor];
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([neighbor, [...path, neighbor]]);
        }
      }
    }
    return null;
  }

  const path = bfsPath(start, end);
  if (!path) {
    result.innerHTML = `<div style="color:var(--warn)">No path found between <strong>${start}</strong> and <strong>${end}</strong></div>`;
    // Reset highlights
    if (window._nodeElements) window._nodeElements.attr('opacity', 0.85).attr('stroke-width', 2).attr('stroke', '#0d1117');
    if (window._linkElements) window._linkElements.attr('opacity', 0.6).classed('active-path-link', false);
    return;
  }

  // Highlight path (neon pulsing path animation!)
  if (window._nodeElements) {
    window._nodeElements
      .transition().duration(300)
      .attr('r', d => {
        if (path.includes(d.login)) return d.login.toLowerCase() === seed.toLowerCase() ? 22 : 14;
        return d.login.toLowerCase() === seed.toLowerCase() ? 18 : (6 + (d.pagerank || 0) * 20);
      })
      .attr('opacity', d => path.includes(d.login) ? 1 : 0.1)
      .attr('stroke', d => path.includes(d.login) ? 'var(--accent2)' : '#0d1117')
      .attr('stroke-width', d => path.includes(d.login) ? 4 : 2);

    window._linkElements
      .transition().duration(300)
      .attr('opacity', d => {
        const s = typeof d.source === 'object' ? d.source.login : d.source;
        const t = typeof d.target === 'object' ? d.target.login : d.target;
        return (path.includes(s) && path.includes(t)) ? 1 : 0.05;
      })
      .attr('stroke-width', d => {
        const s = typeof d.source === 'object' ? d.source.login : d.source;
        const t = typeof d.target === 'object' ? d.target.login : d.target;
        return (path.includes(s) && path.includes(t)) ? 5 : Math.min(d.weight * 2, 8);
      })
      .classed('active-path-link', d => {
        const s = typeof d.source === 'object' ? d.source.login : d.source;
        const t = typeof d.target === 'object' ? d.target.login : d.target;
        return path.includes(s) && path.includes(t);
      });
  }

  const chain = path.map(login => `<div class="path-node" style="cursor:pointer;">${login}</div>`).join('<div class="path-arrow">→</div>');
  result.innerHTML = `
    <div class="path-chain">${chain}</div>
    <div class="path-meta">Path length: ${path.length} nodes</div>
  `;
  
  // Wire up clicking chain nodes to highlight and center them
  result.querySelectorAll('.path-node').forEach(nodeEl => {
    nodeEl.addEventListener('click', () => {
      const login = nodeEl.textContent;
      selectNode(login);
      const matchedNode = graph.nodes.find(n => n.login.toLowerCase() === login.toLowerCase());
      if (matchedNode) zoomToNode(matchedNode);
    });
  });
}

// Tab switching
function setupTabs() {
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(tc => tc.classList.remove('active'));
      
      tab.classList.add('active');
      const tabName = tab.getAttribute('data-tab');
      const targetContent = document.querySelector(`.tab-content.${tabName}`);
      if (targetContent) {
        targetContent.classList.add('active');
      }
      
      if (tabName === 'paths') {
        renderPathsTab();
      }
    });
  });
}

// Status bar
function updateStatus(msg, type = '') {
  statusBar.textContent = msg;
  statusBar.className = type;
}

// Runner for running analysis in side panel
async function runAnalysis(username, graphType, maxNodes) {
  const overlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');
  
  if (overlay && loadingText) {
    loadingText.textContent = `Starting analysis for @${username}...`;
    overlay.style.display = 'flex';
  }
  
  updateStatus(`Analyzing @${username}...`, '');
  
  try {
    const onProgress = (msg) => {
      if (loadingText) loadingText.textContent = msg;
      updateStatus(msg, '');
    };
    
    onProgress(`Fetching profile for @${username}...`);
    const user = await getUser(username);
    let graphObj;

    if (graphType === 'stars') {
      onProgress(`Fetching starred repos for @${user.login}...`);
      const starred = await getStarredRepos(user.login, 2);
      onProgress(`Found ${starred.length} starred repos. Building graph...`);
      graphObj = await buildGraphFromStars(user, starred, getStargazers, onProgress);
    } else if (graphType === 'followers') {
      onProgress(`Building followers network for @${user.login}...`);
      graphObj = await buildGraphFromFollowers(user, getFollowers, getFollowing, onProgress);
    } else if (graphType === 'contributors') {
      onProgress(`Fetching repositories for @${user.login}...`);
      graphObj = await buildGraphFromContributors(user, getUserRepos, getContributors, onProgress);
    } else {
      throw new Error(`Unknown graph type: ${graphType}`);
    }

    if (!graphObj || graphObj.size().nodes <= 1) {
      throw new Error("Could not find any connections to analyze.");
    }

    onProgress('Running centrality algorithms...');
    const influencersList = getRankedInfluencers(graphObj);
    const communitiesList = detectCommunities(graphObj);
    const centralityList  = degreeCentrality(graphObj);

    const communityMap = {};
    let colorIdx = 0;
    for (const [root, members] of communitiesList) {
      for (const m of members) communityMap[m] = colorIdx;
      colorIdx++;
    }

    const d3data = graphObj.toD3();
    d3data.nodes = d3data.nodes.map(n => ({
      ...n,
      community: communityMap[n.login] ?? 0,
      centrality: centralityList.get(n.login) ?? 0,
      pagerank: influencersList.find(i => i.login === n.login)?.score ?? 0
    }));

    const totalNodesCount = d3data.nodes.length;
    const totalEdgesCount = d3data.links.length;
    let prunedNodes = d3data.nodes;
    let prunedLinks = d3data.links;

    if (totalNodesCount > maxNodes) {
      onProgress(`Pruning graph from ${totalNodesCount} to ${maxNodes} nodes...`);
      
      const nodesWithScore = d3data.nodes.map(n => ({
        node: n,
        score: (n.login.toLowerCase() === username.toLowerCase()) ? Infinity : (n.pagerank || n.centrality || 0)
      }));

      nodesWithScore.sort((a, b) => b.score - a.score);

      prunedNodes = nodesWithScore.slice(0, maxNodes).map(x => x.node);
      const keptLogins = new Set(prunedNodes.map(n => n.login));

      prunedLinks = d3data.links.filter(link => {
        const source = typeof link.source === 'object' ? link.source.login : link.source;
        const target = typeof link.target === 'object' ? link.target.login : link.target;
        return keptLogins.has(source) && keptLogins.has(target);
      });
    }

    const prunedLogins = new Set(prunedNodes.map(n => n.login));
    const filteredInfluencers = influencersList
      .filter(i => prunedLogins.has(i.login))
      .slice(0, 20);
    
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

    chrome.storage.local.set({
      sna_graph: finalD3Data,
      sna_influencers: filteredInfluencers,
      sna_communities: prunedCommunityMap,
      sna_seed: user.login,
      sna_stats: {
        nodes: totalNodesCount,
        edges: totalEdgesCount,
        displayNodes: prunedNodes.length,
        displayEdges: prunedLinks.length,
        communities: communitiesList.size
      }
    });

  } catch (err) {
    console.error("Analysis failed:", err);
    updateStatus(`Error: ${err.message}`, 'err');
    alert(`Analysis failed: ${err.message}`);
  } finally {
    if (overlay) overlay.style.display = 'none';
  }
}

// Checks if background.js left a pending request to analyze a user
function checkPendingAnalysis() {
  chrome.storage.local.get(['sna_pending_analysis', 'sna_graph_type', 'sna_max_nodes'], (data) => {
    if (data.sna_pending_analysis && data.sna_pending_analysis.username) {
      const username = data.sna_pending_analysis.username;
      const graphType = data.sna_graph_type || 'stars';
      const maxNodes = data.sna_max_nodes || 100;

      chrome.storage.local.remove('sna_pending_analysis', () => {
        console.log(`Starting pending analysis for ${username} (${graphType}, max ${maxNodes} nodes)...`);
        runAnalysis(username, graphType, maxNodes);
      });
    }
  });
}

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes.sna_graph || changes.sna_influencers) {
      loadGraphData();
    }
    if (changes.sna_pending_analysis && changes.sna_pending_analysis.newValue) {
      checkPendingAnalysis();
    }
  }
});

// Initialize
let initRetries = 0;
const MAX_RETRIES = 50;

function initPanel() {
  if (typeof d3 === 'undefined') {
    initRetries++;
    if (initRetries > MAX_RETRIES) {
      console.error('❌ D3 failed to load after', MAX_RETRIES, 'attempts.');
      updateStatus('Error: D3 library failed to load', 'err');
      return;
    }
    setTimeout(initPanel, 200);
    return;
  }
  
  console.log('✓ Panel loaded, D3 available, setting up...');
  setupTabs();
  
  // Close details card button click
  if (closeDetail && detailCard) {
    closeDetail.addEventListener('click', () => {
      detailCard.style.display = 'none';
      if (window._nodeElements) window._nodeElements.attr('opacity', 0.85).attr('stroke-width', 2).attr('stroke', '#0d1117');
      if (window._linkElements) window._linkElements.attr('opacity', 0.6).classed('active-path-link', false);
    });
  }

  // Search filter node list
  const searchInput = document.getElementById('searchNodes');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim().toLowerCase();
      if (!query) {
        if (window._nodeElements) {
          window._nodeElements.attr('opacity', 0.85).attr('stroke-width', 2).attr('stroke', '#0d1117');
        }
        if (window._linkElements) {
          window._linkElements.attr('opacity', 0.6).classed('active-path-link', false);
        }
        return;
      }

      if (window._nodeElements) {
        window._nodeElements
          .attr('opacity', d => d.login.toLowerCase().includes(query) ? 1 : 0.15)
          .attr('stroke-width', d => d.login.toLowerCase().includes(query) ? 3 : 2)
          .attr('stroke', d => d.login.toLowerCase().includes(query) ? 'var(--accent2)' : '#0d1117');
      }
      if (window._linkElements) {
        window._linkElements.attr('opacity', 0.05);
      }
    });

    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const query = e.target.value.trim().toLowerCase();
        if (!query || !graph || !graph.nodes) return;
        const matched = graph.nodes.find(n => n.login.toLowerCase().includes(query));
        if (matched) {
          selectNode(matched.login);
          zoomToNode(matched);
        }
      }
    });
  }

  // Set up path finding
  const findBtn = document.getElementById('findPathBtn');
  if (findBtn) {
    findBtn.addEventListener('click', findPath);
  }

  // Zoom controls
  const zoomInBtn = document.getElementById('zoomIn');
  const zoomOutBtn = document.getElementById('zoomOut');
  const resetZoomBtn = document.getElementById('resetZoom');
  
  if (zoomInBtn) zoomInBtn.addEventListener('click', () => {
    const svg = d3.select('#graph-svg');
    if (window._zoom) svg.transition().call(window._zoom.scaleBy, 1.5);
  });
  
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => {
    const svg = d3.select('#graph-svg');
    if (window._zoom) svg.transition().call(window._zoom.scaleBy, 0.67);
  });
  
  if (resetZoomBtn) resetZoomBtn.addEventListener('click', () => {
    const svg = d3.select('#graph-svg');
    const width = graphWrap.clientWidth;
    const height = graphWrap.clientHeight;
    if (window._zoom) {
      svg.transition().call(window._zoom.transform, 
        d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8));
    }
  });
  
  loadGraphData();
  checkPendingAnalysis();
}

// Wait for DOM and D3
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPanel);
} else {
  initPanel();
}

// Handle window resize
window.addEventListener('resize', () => {
  if (graph) renderGraph();
});
