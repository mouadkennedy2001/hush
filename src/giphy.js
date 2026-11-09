/**
 * Giphy library — SERVER ONLY (giphy v1.0, Hush v12).
 *
 * The Giphy API key lives ONLY on the server:
 *   1. process.env.GIPHY_API_KEY (preferred, e.g. set by your host), or
 *   2. a gitignored `.env` file in the repo root with `GIPHY_API_KEY=...`
 * It is NEVER imported by browser code, NEVER sent to clients, NEVER
 * logged, and NEVER included in error responses. Browser code in
 * public/js/giphy.js only talks to /api/gif/* on this server.
 *
 * Security model:
 * - Fixed upstream base URL (api.giphy.com). User input is only ever
 *   passed as URLSearchParams — there is no user-controlled URL, so
 *   there is no SSRF surface.
 * - Query / id / rating / lang are all validated + clamped server-side.
 * - Results are normalized down to a tiny safe shape: only media
 *   URLs on *.giphy.com are returned; any upstream URL on another
 *   host is dropped (defense-in-depth against a poisoned upstream).
 * - In-memory cache (60s) + short timeouts protect the API quota.
 * - If no key is configured, every helper throws a typed
 *   `gif-unavailable` error and the HTTP layer returns 503 — the
 *   app keeps working with direct .gif links (Tenor / any https .gif).
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GIPHY_VERSION = '1.0.0';
export const GIPHY_LIBRARY = 'giphy';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_BASE = 'https://api.giphy.com/v1/gifs';
const FETCH_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

const RATINGS = new Set(['g', 'pg', 'pg-13', 'r']);
const GIF_ID_RE = /^[A-Za-z0-9]{4,32}$/;
const LANG_RE = /^[a-z]{2}(?:-[a-z]{2})?$/i;

let cachedKey = null;
let keyLoaded = false;

/** Read the key from env or the gitignored .env file. Do not log it. */
export function loadGiphyKey() {
  if (keyLoaded) return cachedKey;
  keyLoaded = true;
  const fromEnv = String(process.env.GIPHY_API_KEY || '').trim();
  if (fromEnv) { cachedKey = fromEnv; return cachedKey; }
  try {
    const envPath = path.join(ROOT, '.env');
    if (!existsSync(envPath)) return null;
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      if (trimmed.slice(0, eq).trim() !== 'GIPHY_API_KEY') continue;
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      value = value.trim();
      if (value) { cachedKey = value; return cachedKey; }
    }
  } catch { /* no key file — gif-unavailable is a valid state */ }
  return null;
}

/** Test hook: forget the cached key so a changed env/.env is picked up. */
export function resetGiphyKeyCache() { cachedKey = null; keyLoaded = false; }

export function isGiphyConfigured() { return Boolean(loadGiphyKey()); }

export function cleanGiphyQuery(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}
export function cleanGiphyId(value) {
  const id = String(value ?? '').trim();
  return GIF_ID_RE.test(id) ? id : '';
}
export function cleanRating(value) {
  const r = String(value ?? '').toLowerCase().trim();
  return RATINGS.has(r) ? r : 'pg-13';
}
export function cleanLang(value) {
  const l = String(value ?? '').toLowerCase().trim();
  return LANG_RE.test(l) ? l : 'en';
}
export function cleanLimit(value, fallback = 12) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(24, Math.max(1, Math.floor(n)));
}
export function cleanOffset(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(200, Math.max(0, Math.floor(n)));
}

/** Only *.giphy.com https media URLs are ever handed to browsers. */
export function isGiphyMediaUrl(url) {
  try {
    const u = new URL(String(url ?? ''));
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    return host === 'media.giphy.com' || host === 'i.giphy.com' || host.endsWith('.giphy.com');
  } catch { return false; }
}

/** Normalize one upstream gif object to the tiny safe client shape. */
export function normalizeGiphyGif(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanGiphyId(raw.id);
  if (!id) return null;
  const images = raw.images && typeof raw.images === 'object' ? raw.images : {};
  const pick = (rendition) => {
    const r = images[rendition];
    if (!r || typeof r !== 'object') return null;
    const url = String(r.url || '');
    if (!isGiphyMediaUrl(url)) return null;
    return {
      url,
      width: Number.isFinite(Number(r.width)) ? Number(r.width) : 0,
      height: Number.isFinite(Number(r.height)) ? Number(r.height) : 0,
      size: Number.isFinite(Number(r.size)) ? Number(r.size) : 0
    };
  };
  const original = pick('original') || pick('gif') || pick('fixed_height');
  if (!original) return null;
  const preview = pick('fixed_width') || pick('fixed_height_small') || original;
  const title = String(raw.title ?? raw.slug ?? 'GIF').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || 'GIF';
  return {
    id,
    title,
    url: original.url,
    preview: preview.url,
    width: original.width,
    height: original.height,
    rating: RATINGS.has(String(raw.rating || '').toLowerCase()) ? String(raw.rating).toLowerCase() : 'g'
  };
}

function gifUnavailable() {
  const error = new Error('gif-unavailable');
  error.status = 503;
  return error;
}

// Tiny TTL cache — keyed by endpoint+params, never by API key.
const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.value;
}
function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, { at: Date.now(), value });
}

async function giphyGet(endpoint, params) {
  const key = loadGiphyKey();
  if (!key) throw gifUnavailable();
  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  url.searchParams.set('api_key', key);
  const cacheKey = `${endpoint}:${url.searchParams.toString().replace(/api_key=[^&]+/, 'api_key=***')}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined
    });
  } catch {
    const error = new Error('gif-upstream-failed');
    error.status = 502;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(response.status === 429 ? 'gif-rate-limited' : 'gif-upstream-failed');
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  const data = await response.json().catch(() => null);
  if (!data) {
    const error = new Error('gif-upstream-failed');
    error.status = 502;
    throw error;
  }
  cacheSet(cacheKey, data);
  return data;
}

function normalizeList(data) {
  const list = Array.isArray(data?.data) ? data.data : [];
  const gifs = list.map(normalizeGiphyGif).filter(Boolean);
  const pagination = data?.pagination && typeof data.pagination === 'object' ? data.pagination : {};
  return {
    gifs,
    total: Number.isFinite(Number(pagination.total_count)) ? Number(pagination.total_count) : gifs.length,
    count: gifs.length
  };
}

export async function searchGifs({ q = '', limit = 12, offset = 0, rating = 'pg-13', lang = 'en' } = {}) {
  const query = cleanGiphyQuery(q);
  if (!query) throw Object.assign(new Error('gif-query-required'), { status: 400 });
  const data = await giphyGet('search', {
    q: query, limit: cleanLimit(limit), offset: cleanOffset(offset),
    rating: cleanRating(rating), lang: cleanLang(lang)
  });
  return normalizeList(data);
}

export async function trendingGifs({ limit = 12, offset = 0, rating = 'pg-13' } = {}) {
  const data = await giphyGet('trending', {
    limit: cleanLimit(limit), offset: cleanOffset(offset), rating: cleanRating(rating)
  });
  return normalizeList(data);
}

export async function randomGif({ tag = '' } = {}) {
  const cleanTag = cleanGiphyQuery(tag);
  const data = await giphyGet('random', cleanTag ? { tag: cleanTag, rating: 'pg-13' } : { rating: 'pg-13' });
  const gif = normalizeGiphyGif(data?.data);
  if (!gif) throw Object.assign(new Error('gif-not-found'), { status: 404 });
  return { gif };
}

export async function getGifById(id) {
  const cleanId = cleanGiphyId(id);
  if (!cleanId) throw Object.assign(new Error('gif-not-found'), { status: 404 });
  const data = await giphyGet(cleanId, {});
  const gif = normalizeGiphyGif(data?.data);
  if (!gif) throw Object.assign(new Error('gif-not-found'), { status: 404 });
  return { gif };
}

export default {
  GIPHY_VERSION, GIPHY_LIBRARY,
  loadGiphyKey, isGiphyConfigured, resetGiphyKeyCache,
  cleanGiphyQuery, cleanGiphyId, cleanRating, cleanLang, cleanLimit, cleanOffset,
  isGiphyMediaUrl, normalizeGiphyGif,
  searchGifs, trendingGifs, randomGif, getGifById
};
