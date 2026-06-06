// api/github.js — all GitHub REST API calls
// Every function checks the cache (chrome.storage.local) before hitting the API.
// On a cache miss, it fetches from GitHub and stores the result for future calls.

import { cacheGet, cacheSet, TTL_6H, TTL_2H, TTL_30M } from './cache.js';

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

// ─── User Profile ────────────────────────────────────────────────────────────
// Cached for 6 hours — profile info changes rarely.

export async function getUser(username) {
  const key = `user_${username.toLowerCase()}`;

  const cached = await cacheGet(key);
  if (cached) {
    console.log(`[cache HIT] ${key}`);
    return cached;
  }

  console.log(`[cache MISS] ${key} → fetching from API`);
  const data = await get(`/users/${username}`);
  await cacheSet(key, data, TTL_6H);
  return data;
}

// ─── Starred Repos ───────────────────────────────────────────────────────────
// Cached for 2 hours — stars change occasionally.

export async function getStarredRepos(username, maxPages = 2) {
  const key = `starred_${username.toLowerCase()}_p${maxPages}`;

  const cached = await cacheGet(key);
  if (cached) {
    console.log(`[cache HIT] ${key}`);
    return cached;
  }

  console.log(`[cache MISS] ${key} → fetching from API`);
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await get(`/users/${username}/starred`, { per_page: 30, page });
    all.push(...data);
    if (data.length < 30) break;
  }
  await cacheSet(key, all, TTL_2H);
  return all;
}

// ─── User Repos ──────────────────────────────────────────────────────────────
// Cached for 2 hours.

export async function getUserRepos(username, maxPages = 2) {
  const key = `repos_${username.toLowerCase()}_p${maxPages}`;

  const cached = await cacheGet(key);
  if (cached) {
    console.log(`[cache HIT] ${key}`);
    return cached;
  }

  console.log(`[cache MISS] ${key} → fetching from API`);
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await get(`/users/${username}/repos`, { per_page: 30, page });
    all.push(...data);
    if (data.length < 30) break;
  }
  await cacheSet(key, all, TTL_2H);
  return all;
}

// ─── Stargazers ──────────────────────────────────────────────────────────────
// Cached per repo for 2 hours — individual repo stars change slowly.

export async function getStargazers(owner, repo, maxPages = 2) {
  const key = `stargazers_${owner.toLowerCase()}_${repo.toLowerCase()}_p${maxPages}`;

  const cached = await cacheGet(key);
  if (cached) {
    console.log(`[cache HIT] ${key}`);
    return cached;
  }

  console.log(`[cache MISS] ${key} → fetching from API`);
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await get(`/repos/${owner}/${repo}/stargazers`, { per_page: 30, page });
    all.push(...data);
    if (data.length < 30) break;
  }
  await cacheSet(key, all, TTL_2H);
  return all;
}

// ─── Contributors ─────────────────────────────────────────────────────────────
// Cached per repo for 2 hours.

export async function getContributors(owner, repo) {
  const key = `contributors_${owner.toLowerCase()}_${repo.toLowerCase()}`;

  const cached = await cacheGet(key);
  if (cached) {
    console.log(`[cache HIT] ${key}`);
    return cached;
  }

  console.log(`[cache MISS] ${key} → fetching from API`);
  const data = await get(`/repos/${owner}/${repo}/contributors`, { per_page: 30 }).catch(() => []);
  await cacheSet(key, data, TTL_2H);
  return data;
}

// ─── Followers ───────────────────────────────────────────────────────────────
// Cached for 2 hours.

export async function getFollowers(username) {
  const key = `followers_${username.toLowerCase()}`;

  const cached = await cacheGet(key);
  if (cached) {
    console.log(`[cache HIT] ${key}`);
    return cached;
  }

  console.log(`[cache MISS] ${key} → fetching from API`);
  const data = await get(`/users/${username}/followers`, { per_page: 50 }).catch(() => []);
  await cacheSet(key, data, TTL_2H);
  return data;
}

// ─── Following ───────────────────────────────────────────────────────────────
// Cached for 2 hours.

export async function getFollowing(username) {
  const key = `following_${username.toLowerCase()}`;

  const cached = await cacheGet(key);
  if (cached) {
    console.log(`[cache HIT] ${key}`);
    return cached;
  }

  console.log(`[cache MISS] ${key} → fetching from API`);
  const data = await get(`/users/${username}/following`, { per_page: 50 }).catch(() => []);
  await cacheSet(key, data, TTL_2H);
  return data;
}

// ─── Rate Limit ───────────────────────────────────────────────────────────────
// NOT cached — always fetch fresh so the display is accurate.

export async function getRateLimit() {
  return get("/rate_limit");
}
