// api/github.js — all GitHub REST API calls

const BASE = "https://api.github.com";

let _token = "";

export function setToken(tok) { _token = tok; }

function headers() {
  const h = { "Accept": "application/vnd.github+json" };
  if (_token) h["Authorization"] = `Bearer ${_token}`;
  return h;
}

async function get(path, params = {}) {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error ${res.status}`);
  }
  return res.json();
}

export async function getUser(username) {
  return get(`/users/${username}`);
}

export async function getStarredRepos(username, maxPages = 2) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await get(`/users/${username}/starred`, { per_page: 30, page });
    all.push(...data);
    if (data.length < 30) break;
  }
  return all;
}

export async function getUserRepos(username, maxPages = 2) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await get(`/users/${username}/repos`, { per_page: 30, page });
    all.push(...data);
    if (data.length < 30) break;
  }
  return all;
}

export async function getStargazers(owner, repo, maxPages = 2) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await get(`/repos/${owner}/${repo}/stargazers`, { per_page: 30, page });
    all.push(...data);
    if (data.length < 30) break;
  }
  return all;
}

export async function getContributors(owner, repo) {
  return get(`/repos/${owner}/${repo}/contributors`, { per_page: 30 }).catch(() => []);
}

export async function getFollowers(username) {
  return get(`/users/${username}/followers`, { per_page: 50 }).catch(() => []);
}

export async function getFollowing(username) {
  return get(`/users/${username}/following`, { per_page: 50 }).catch(() => []);
}

export async function getRateLimit() {
  return get("/rate_limit");
}

