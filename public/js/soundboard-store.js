// Personal permanent soundboard — stored on THIS device only.
// Audio Blobs live in IndexedDB (localStorage caps at ~5MB, far too small for
// audio); a tiny metadata index (name/emoji/cover) is mirrored to
// localStorage so buttons render instantly before IndexedDB opens.
// Nothing here touches the server until the user presses "Share to room /
// server" — then the Blob is uploaded through the existing board endpoints
// (2MB server cap). That keeps server disk small: local sounds cost 0 bytes
// on the server until shared, and room sounds are purged when the room
// empties (permanent server sounds are deleted with the server).

const DB_NAME = 'hush-soundboard';
const DB_VERSION = 1;
const STORE = 'sounds';
const INDEX_KEY = 'hush:my-sounds-index';
export const MAX_PERSONAL_SOUNDS = 30;
export const MAX_PERSONAL_AUDIO_BYTES = 5 * 1024 * 1024;
export const PERSONAL_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.webm', '.opus']);
export const MAX_PERSONAL_IMAGE_BYTES = 2 * 1024 * 1024;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('indexeddb-unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexeddb-open-failed'));
  });
  // Never cache a rejection forever (private mode can fail once, then work).
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx(mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error || new Error('indexeddb-tx-failed'));
  }));
}

export async function listPersonalSounds() {
  try {
    return await tx('readonly', (store) => store.getAll()) || [];
  } catch { return readIndex(); }
}

export async function getPersonalSound(id) {
  try { return await tx('readonly', (store) => store.get(id)) || null; }
  catch { return null; }
}

export async function putPersonalSound(record) {
  if (!record || !record.id) throw new Error('invalid-sound');
  await tx('readwrite', (store) => store.put(record));
  writeIndex();
}

export async function deletePersonalSound(id) {
  try { await tx('readwrite', (store) => store.delete(id)); } catch { /* ignore */ }
  writeIndex();
}

export async function clearPersonalSounds() {
  try { await tx('readwrite', (store) => store.clear()); } catch { /* ignore */ }
  try { localStorage.removeItem(INDEX_KEY); } catch { /* ignore */ }
}

export function readIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function writeIndex() {
  try {
    const all = await listPersonalSounds();
    const index = all.map(({ id, name, emojiId, imageDataUrl, createdAt, size, mime }) => ({
      id, name, emojiId, imageDataUrl, createdAt, size, mime
    }));
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch { /* quota / private mode: IndexedDB still holds the audio */ }
}

/** Downscale an image File to a small square dataURL (cover for a button). */
export function imageFileToDataUrl(file, { max = 128 } = {}) {
  return new Promise((resolve, reject) => {
    const ext = String(file?.name || '').toLowerCase();
    const dot = ext.lastIndexOf('.');
    const suffix = dot >= 0 ? ext.slice(dot) : '';
    if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(suffix)) {
      reject(new Error('unsupported-image')); return;
    }
    if (file.size > MAX_PERSONAL_IMAGE_BYTES) { reject(new Error('image-too-large')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const side = Math.max(1, Math.min(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = max; canvas.height = max;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(max / img.width, max / img.height);
        const w = img.width * scale; const h = img.height * scale;
        ctx.drawImage(img, (max - w) / 2, (max - h) / 2, w, h);
        URL.revokeObjectURL(url);
        void side;
        resolve(canvas.toDataURL('image/webp', 0.82));
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('invalid-image')); };
    img.src = url;
  });
}

export function validatePersonalAudio(file) {
  if (!file) return 'missing-file';
  const ext = String(file.name || '').toLowerCase();
  const dot = ext.lastIndexOf('.');
  const suffix = dot >= 0 ? ext.slice(dot) : '';
  if (!PERSONAL_AUDIO_EXTENSIONS.has(suffix)) return 'unsupported-file-type';
  if (file.size > MAX_PERSONAL_AUDIO_BYTES) return 'file-too-large';
  return null;
}

let blobUrlCache = new Map();
export function personalBlobUrl(record) {
  if (!record || record.audio == null) return '';
  if (blobUrlCache.has(record.id)) return blobUrlCache.get(record.id);
  const blob = record.audio instanceof Blob
    ? record.audio
    : new Blob([record.audio], { type: record.mime || 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(record.id, url);
  return url;
}
