// algorithms/bfs.js
// BFS shortest path between two users in the graph
// Time Complexity: O(V + E)

export function bfsShortestPath(adjList, start, end) {
  if (start === end) return [start];
  if (!adjList.has(start) || !adjList.has(end)) return null;

  const visited = new Set([start]);
  const queue = [[start, [start]]];   // [currentNode, pathSoFar]

  while (queue.length > 0) {
    const [node, path] = queue.shift();
    const neighbors = adjList.get(node) || new Map();

    for (const [neighbor] of neighbors) {
      if (neighbor === end) return [...path, neighbor];
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([neighbor, [...path, neighbor]]);
      }
    }
  }
  return null;  // no path found
}

// BFS to get all reachable nodes within `maxDepth` hops
export function bfsReachable(adjList, start, maxDepth = 3) {
  const visited = new Map();   // login → depth
  visited.set(start, 0);
  const queue = [[start, 0]];

  while (queue.length > 0) {
    const [node, depth] = queue.shift();
    if (depth >= maxDepth) continue;
    const neighbors = adjList.get(node) || new Map();
    for (const [neighbor] of neighbors) {
      if (!visited.has(neighbor)) {
        visited.set(neighbor, depth + 1);
        queue.push([neighbor, depth + 1]);
      }
    }
  }
  return visited;
}
