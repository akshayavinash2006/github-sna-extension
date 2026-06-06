// sidepanel/panel.js — render and interact with graph

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
        updateStatus('No graph data. Run an analysis in popup.', '');
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
      if (d.login === seed) return 18;
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

  // Labels (optional - can be hidden for performance)
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

// Select node and highlight
function selectNode(login) {
  if (!window._nodeElements) return;

  window._nodeElements
    .attr('opacity', d => d.login === login ? 1 : 0.3)
    .attr('stroke-width', d => d.login === login ? 3 : 2);

  window._linkElements
    .attr('opacity', d => d.source.login === login || d.target.login === login ? 0.8 : 0.1);

  // Show in sidebar
  const detail = document.querySelector('[data-username]');
  if (detail) detail.setAttribute('data-username', login);
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
    item.addEventListener('click', () => selectNode(inf.login));
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
      chip.addEventListener('click', () => selectNode(login));
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
    if (!adj.has(start) || !adj.has(end)) return null;
    
    const visited = new Set([start]);
    const queue = [[start, [start]]];
    
    while (queue.length > 0) {
      const [node, path] = queue.shift();
      for (const neighbor of adj.get(node).keys()) {
        if (neighbor === end) return [...path, neighbor];
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
    return;
  }

  // Highlight path
  if (window._nodeElements) {
    window._nodeElements.attr('opacity', d => path.includes(d.login) ? 1 : 0.2);
    window._linkElements.attr('opacity', d => 
      (path.includes(d.source.login) && path.includes(d.target.login)) ? 0.8 : 0.05
    );
  }

  const chain = path.map(login => `<div class="path-node">${login}</div>`).join('<div class="path-arrow">→</div>');
  result.innerHTML = `
    <div class="path-chain">${chain}</div>
    <div class="path-meta">Path length: ${path.length} nodes</div>
  `;
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

// Listen for storage changes (if user runs new analysis)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && (changes.sna_graph || changes.sna_influencers)) {
    loadGraphData();
  }
});

// Initialize
let initRetries = 0;
const MAX_RETRIES = 50;

function initPanel() {
  if (typeof d3 === 'undefined') {
    initRetries++;
    if (initRetries > MAX_RETRIES) {
      console.error('❌ D3 failed to load after', MAX_RETRIES, 'attempts. Check network/CSP.');
      updateStatus('Error: D3 library failed to load', 'err');
      return;
    }
    if (initRetries % 10 === 0) {
      console.warn(`D3 not loaded yet (attempt ${initRetries}/${MAX_RETRIES})...`);
    }
    setTimeout(initPanel, 200);
    return;
  }
  
  console.log('✓ Panel loaded, D3 available, setting up...');
  setupTabs();
  
  // Set up path finding
  const findBtn = document.getElementById('findPathBtn');
  if (findBtn) {
    findBtn.addEventListener('click', findPath);
  }

  // Set up zoom controls
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
