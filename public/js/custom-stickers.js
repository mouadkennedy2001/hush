// Custom stickers — private on-device library (Hush v12).
//
// Created stickers live FIRST on this device only:
//   - IndexedDB (primary, stores real Blobs — large images, no quota
//     issues with localStorage's ~5MB string limit), and
//   - localStorage (fallback for small images when IndexedDB is
//     unavailable, e.g. private browsing — data URLs, capped).
// Nothing is uploaded until the user presses Send. Sending reads the
// Blob back out of IndexedDB/localStorage and uploads it through the
// existing room/server upload endpoints, then sends it as an image
// attachment — so the server copy comes FROM the local store.
//
// Security: raster images only (png/jpeg/gif/webp/avif). SVG is
// rejected — an uploaded SVG could carry script if ever opened as a
// document. Names are sanitized, counts/sizes are capped so a page
// cannot fill the device store.
export const CUSTOM_STICKER_DB = 'hush-custom-stickers';
export const CUSTOM_STICKER_STORE = 'stickers';
export const CUSTOM_STICKER_LS_KEY = 'hush:custom-stickers';
export const CUSTOM_STICKER_MAX_COUNT = 30;
export const CUSTOM_STICKER_MAX_BYTES = 2 * 1024 * 1024; // per sticker
export const CUSTOM_STICKER_TOTAL_BYTES = 12 * 1024 * 1024;
export const CUSTOM_STICKER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

export function cleanCustomStickerName(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Sticker';
}

export function validateStickerFile(file) {
  if (!file) return { ok: false, error: 'empty' };
  const type = String(file.type || '').toLowerCase();
  if (!CUSTOM_STICKER_TYPES.has(type)) return { ok: false, error: 'type' };
  if (Number(file.size) > CUSTOM_STICKER_MAX_BYTES) return { ok: false, error: 'size' };
  if (!(Number(file.size) > 0)) return { ok: false, error: 'empty' };
  if (/svg|html|script/i.test(String(file.name || ''))) return { ok: false, error: 'type' };
  return { ok: true };
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no-indexeddb')); return; }
    const req = indexedDB.open(CUSTOM_STICKER_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CUSTOM_STICKER_STORE)) {
        const store = db.createObjectStore(CUSTOM_STICKER_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb-open-failed'));
  });
}

async function idbAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOM_STICKER_STORE, 'readonly');
    const req = tx.objectStore(CUSTOM_STICKER_STORE).getAll();
    req.onsuccess = () => { db.close(); resolve(Array.isArray(req.result) ? req.result : []); };
    req.onerror = () => { db.close(); reject(req.error || new Error('idb-read-failed')); };
  });
}
async function idbPut(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOM_STICKER_STORE, 'readwrite');
    tx.objectStore(CUSTOM_STICKER_STORE).put(record);
    tx.oncomplete = () => { db.close(); resolve(record); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('idb-write-failed')); };
  });
}
async function idbDelete(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOM_STICKER_STORE, 'readwrite');
    tx.objectStore(CUSTOM_STICKER_STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('idb-delete-failed')); };
  });
}

// ---- localStorage fallback (small stickers only) ----
function lsRead() {
  try {
    const raw = localStorage.getItem(CUSTOM_STICKER_LS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function lsWrite(list) {
  try { localStorage.setItem(CUSTOM_STICKER_LS_KEY, JSON.stringify(list)); return true; }
  catch { return false; }
}
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('read-failed'));
    reader.readAsDataURL(blob);
  });
}
function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) return null;
  try {
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: match[1] });
  } catch { return null; }
}

function publicRecord(record) {
  return {
    id: String(record.id),
    name: cleanCustomStickerName(record.name),
    type: String(record.type || 'image/png'),
    size: Number(record.size) || 0,
    createdAt: Number(record.createdAt) || 0,
    source: record.source || 'indexeddb'
  };
}

export async function listCustomStickers() {
  try {
    const all = await idbAll();
    return all.map(publicRecord).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return lsRead().map(publicRecord).sort((a, b) => b.createdAt - a.createdAt);
  }
}

export async function getCustomStickerBlob(id) {
  const cleanId = String(id || '').slice(0, 80);
  if (!cleanId) return null;
  try {
    const db = await openDb();
    const record = await new Promise((resolve, reject) => {
      const req = db.transaction(CUSTOM_STICKER_STORE, 'readonly').objectStore(CUSTOM_STICKER_STORE).get(cleanId);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); reject(req.error || new Error('idb-read-failed')); };
    });
    if (record?.blob) return record.blob;
    if (record?.dataUrl) return dataUrlToBlob(record.dataUrl);
  } catch { /* fall through to localStorage */ }
  const found = lsRead().find((r) => r.id === cleanId);
  return found?.dataUrl ? dataUrlToBlob(found.dataUrl) : null;
}

export async function addCustomSticker({ name, blob, type } = {}) {
  const check = validateStickerFile({ type: type || blob?.type, size: blob?.size ?? 0, name: '' });
  if (!blob || !check.ok) throw new Error(check.error || 'invalid-sticker');
  const existing = await listCustomStickers();
  if (existing.length >= CUSTOM_STICKER_MAX_COUNT) throw new Error('sticker-limit');
  const total = existing.reduce((sum, s) => sum + (Number(s.size) || 0), 0);
  if (total + Number(blob.size || 0) > CUSTOM_STICKER_TOTAL_BYTES) throw new Error('sticker-quota');
  const record = {
    id: `custom-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    name: cleanCustomStickerName(name),
    type: String(blob.type || type || 'image/png').toLowerCase(),
    size: Number(blob.size) || 0,
    createdAt: Date.now(),
    source: 'indexeddb'
  };
  try {
    await idbPut({ ...record, blob });
    return publicRecord(record);
  } catch {
    // IndexedDB unavailable/full — small-image localStorage fallback.
    if (Number(blob.size) > 512 * 1024) throw new Error('sticker-store-unavailable');
    const dataUrl = await blobToDataUrl(blob);
    const list = lsRead();
    list.push({ ...record, source: 'localstorage', dataUrl });
    if (!lsWrite(list)) throw new Error('sticker-store-unavailable');
    return publicRecord(record);
  }
}

export async function deleteCustomSticker(id) {
  const cleanId = String(id || '').slice(0, 80);
  if (!cleanId) return false;
  try { await idbDelete(cleanId); } catch { /* ignore */ }
  const list = lsRead().filter((r) => r.id !== cleanId);
  lsWrite(list);
  revokeCustomStickerUrl(cleanId);
  return true;
}

// Object URLs are cached so grids don't churn; revoke on delete.
const urlCache = new Map();
export async function getCustomStickerUrl(id) {
  const cleanId = String(id || '').slice(0, 80);
  if (urlCache.has(cleanId)) return urlCache.get(cleanId);
  const blob = await getCustomStickerBlob(cleanId);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  urlCache.set(cleanId, url);
  return url;
}
export function revokeCustomStickerUrl(id) {
  const url = urlCache.get(String(id || ''));
  if (url) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } urlCache.delete(String(id || '')); }
}

export function customStickerImg(record, url, className = 'custom-sticker emoji-sticker') {
  const img = document.createElement('img');
  img.src = url || '';
  img.alt = cleanCustomStickerName(record?.name);
  img.title = cleanCustomStickerName(record?.name);
  img.className = className;
  img.draggable = false;
  img.loading = 'lazy';
  img.decoding = 'async';
  return img;
}

export default {
  CUSTOM_STICKER_DB, CUSTOM_STICKER_MAX_COUNT, CUSTOM_STICKER_MAX_BYTES, CUSTOM_STICKER_TYPES,
  cleanCustomStickerName, validateStickerFile,
  listCustomStickers, getCustomStickerBlob, addCustomSticker, deleteCustomSticker,
  getCustomStickerUrl, customStickerImg
};
