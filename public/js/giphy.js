// Giphy client — talks ONLY to the server proxy (/api/gif/*).
// The API key never appears here (it lives server-side in src/giphy.js).
// Every result carries a media.giphy.com URL that renders inline now
// that CSP allows https images (the error/-folder broken-GIF fix).
export const GIPHY_CLIENT_VERSION = '1.0.0';

async function getJson(url, { signal } = {}) {
  const res = await fetch(url, { cache: 'no-store', signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data?.error || 'gif-failed');
    error.code = data?.error || 'gif-failed';
    error.status = res.status;
    throw error;
  }
  return data;
}

export async function gifStatus({ signal } = {}) {
  try { return await getJson('/api/gif/status', { signal }); }
  catch { return { ok: false, configured: false }; }
}

export async function searchGifs(query, { limit = 12, offset = 0, signal } = {}) {
  const q = String(query ?? '').trim().slice(0, 80);
  if (!q) return { gifs: [], total: 0, count: 0 };
  const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset), rating: 'pg-13', lang: 'en' });
  return getJson(`/api/gif/search?${params}`, { signal });
}

export async function trendingGifs({ limit = 12, offset = 0, signal } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset), rating: 'pg-13' });
  return getJson(`/api/gif/trending?${params}`, { signal });
}

export async function randomGif(tag = '', { signal } = {}) {
  const params = new URLSearchParams();
  if (tag) params.set('tag', String(tag).slice(0, 80));
  const qs = params.toString();
  return getJson(`/api/gif/random${qs ? `?${qs}` : ''}`, { signal });
}

export async function getGif(id, { signal } = {}) {
  return getJson(`/api/gif/${encodeURIComponent(String(id))}`, { signal });
}

/** Thumbnail <img> for picker grids — lazy, no-referrer, never throws. */
export function giphyThumb(gif, { className = 'gif-thumb', alt = '' } = {}) {
  const img = document.createElement('img');
  img.src = gif?.preview || gif?.url || '';
  img.alt = alt || gif?.title || 'GIF';
  img.title = gif?.title || 'GIF';
  img.className = className;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.draggable = false;
  img.referrerPolicy = 'no-referrer';
  return img;
}

export default { GIPHY_CLIENT_VERSION, gifStatus, searchGifs, trendingGifs, randomGif, getGif, giphyThumb };
