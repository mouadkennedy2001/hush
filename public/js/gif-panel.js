// Shared GIF + custom-sticker picker panels for rooms and servers.
// One implementation (was duplicated in room.js/server.js) — both
// pages import this. The picker has three parts:
//   1. Giphy search (server proxy, no key in browser) + Trending +
//      Random, results insert the media URL into the composer.
//   2. Paste any direct https .gif link (Tenor / anywhere) — the
//      original feature, kept as a secondary row.
//   3. "My stickers" — private IndexedDB library + creator dialog.
//      Sending one uploads its Blob from IndexedDB via the caller's
//      onSendCustomSticker(blob, record) hook (existing upload flow).
import { searchGifs, trendingGifs, randomGif, giphyThumb } from './giphy.js';
import { isGifUrl } from './emoji.js';
import {
  listCustomStickers, getCustomStickerUrl, deleteCustomSticker,
  addCustomSticker, validateStickerFile, cleanCustomStickerName, customStickerImg
} from './custom-stickers.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function pickText(t, key) { try { return t(key); } catch { return key; } }

export function buildGifPanel(grid, { query = '', t, toast, onInsert, onSendCustomSticker, onOpenStickerCreator } = {}) {
  grid.replaceChildren();
  // v12.1: the panel must NOT be a grid item of the 6-column emoji grid
  // (that crushed every row/button into a ~50px cell and stretched them
  // vertically, worst in RTL). Switch the grid to block + wrap in a panel.
  grid.classList.add('is-panel');
  const panel = el('div', 'gif-panel');
  grid.append(panel);
  const hint = el('p', 'emoji-empty', pickText(t, 'gif.hint'));
  panel.append(hint);

  // --- Giphy search row ---
  const searchRow = el('div', 'gif-row');
  const searchInput = el('input', 'emoji-search gif-input');
  searchInput.type = 'search';
  searchInput.placeholder = pickText(t, 'gif.searchPlaceholder');
  searchInput.setAttribute('aria-label', pickText(t, 'gif.searchPlaceholder'));
  searchInput.value = String(query || '');
  const searchBtn = el('button', 'btn btn-primary btn-sm', pickText(t, 'gif.search'));
  searchBtn.type = 'button';
  searchRow.append(searchInput, searchBtn);
  panel.append(searchRow);

  const actions = el('div', 'gif-row');
  const trendingBtn = el('button', 'btn btn-quiet btn-sm', pickText(t, 'gif.trending'));
  trendingBtn.type = 'button';
  const randomBtn = el('button', 'btn btn-quiet btn-sm', pickText(t, 'gif.random'));
  randomBtn.type = 'button';
  const mineBtn = el('button', 'btn btn-quiet btn-sm', pickText(t, 'gif.mine'));
  mineBtn.type = 'button';
  const createBtn = el('button', 'btn btn-quiet btn-sm', pickText(t, 'sticker.create'));
  createBtn.type = 'button';
  actions.append(trendingBtn, randomBtn, mineBtn, createBtn);
  panel.append(actions);

  const results = el('div', 'gif-grid');
  results.setAttribute('role', 'listbox');
  panel.append(results);

  let controller = null;
  async function load(loader) {
    controller?.abort();
    controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    results.replaceChildren(el('p', 'emoji-empty', pickText(t, 'gif.loading')));
    try {
      const data = await loader(controller?.signal);
      results.replaceChildren();
      const gifs = Array.isArray(data?.gifs) ? data.gifs : (data?.gif ? [data.gif] : []);
      if (!gifs.length) { results.append(el('p', 'emoji-empty', pickText(t, 'gif.empty'))); return; }
      for (const gif of gifs) {
        const button = el('button', 'gif-choice');
        button.type = 'button';
        button.setAttribute('role', 'option');
        button.setAttribute('aria-label', gif.title || 'GIF');
        button.title = gif.title || 'GIF';
        button.append(giphyThumb(gif));
        button.addEventListener('click', () => { onInsert?.(gif.url); });
        results.append(button);
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
      results.replaceChildren(el('p', 'emoji-empty', pickText(t, 'gif.failed')));
    }
  }

  searchBtn.addEventListener('click', () => {
    const q = searchInput.value.trim();
    if (!q) { toast?.(pickText(t, 'gif.invalid'), 'error', 3000); return; }
    void load((signal) => searchGifs(q, { signal }));
  });
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchBtn.click(); } });
  trendingBtn.addEventListener('click', () => void load((signal) => trendingGifs({ signal })));
  randomBtn.addEventListener('click', () => void load((signal) => randomGif(searchInput.value.trim(), { signal })));
  mineBtn.addEventListener('click', () => void renderMine(results, { t, toast, onSendCustomSticker }));
  createBtn.addEventListener('click', () => { onOpenStickerCreator?.(); });

  // --- Paste-link row (kept from v11) ---
  const row = el('div', 'gif-row');
  const input = el('input', 'emoji-search gif-input');
  input.type = 'url';
  input.placeholder = 'https://…/image.gif';
  input.setAttribute('aria-label', 'GIF link');
  const add = el('button', 'btn btn-primary btn-sm', pickText(t, 'gif.add'));
  add.type = 'button';
  const open = el('button', 'btn btn-quiet btn-sm', pickText(t, 'gif.openFree'));
  open.type = 'button';
  open.addEventListener('click', () => {
    const q = encodeURIComponent(searchInput.value.trim() || 'funny');
    window.open(`https://tenor.com/search/${q}`, '_blank', 'noopener,noreferrer');
  });
  add.addEventListener('click', () => {
    const url = input.value.trim();
    if (!isGifUrl(url)) { toast?.(pickText(t, 'gif.invalid'), 'error', 3000); return; }
    onInsert?.(url);
  });
  row.append(input, add, open);
  panel.append(row);

  // Start with trending so the panel is never empty-looking.
  void load((signal) => trendingGifs({ signal }));
  return { searchInput, results };
}

/* ---------------- Dedicated sticker menu (v12.1, shared) ----------------
 * Separate from the emoji menu: category tabs are localized
 * (Arabic in ar, English in en — was hardcoded English), plus
 * "My stickers" (IndexedDB) and "Create sticker". */
export function buildStickerMenu(menu, { t, toast, locale, onInsertSticker, onSendCustomSticker, onOpenStickerCreator } = {}) {
  const { CUSTOM_STICKERS, STICKER_CATEGORIES, customStickerImage, searchStickers, stickerLabel } = stickerMenuDeps;
  menu.replaceChildren();
  const search = el('input', 'emoji-search');
  search.type = 'search';
  search.placeholder = pickText(t, 'emoji.search');
  search.setAttribute('aria-label', pickText(t, 'emoji.search'));
  const tabs = el('div', 'emoji-tabs');
  const grid = el('div', 'emoji-grid');
  grid.id = 'sticker-grid';
  grid.setAttribute('role', 'listbox');
  let activeCat = 'faces';
  const lang = () => { try { return locale ? locale() : 'en'; } catch { return 'en'; } };
  const catLabel = (cat) => (lang() === 'ar' ? cat.ar : cat.en);

  function renderGrid(query = '') {
    grid.replaceChildren();
    grid.classList.remove('is-panel');
    if (activeCat === 'mine') { void renderMine(grid, { t, toast, onSendCustomSticker }); return; }
    const q = String(query || '').trim();
    let list;
    if (q) list = searchStickers(q);
    else list = CUSTOM_STICKERS.filter((e) => e.cat === activeCat);
    if (!list.length) { grid.append(el('div', 'emoji-empty', pickText(t, 'emoji.noResults'))); return; }
    for (const sticker of list) {
      const button = el('button', 'emoji-choice');
      button.type = 'button';
      button.dataset.emoji = sticker.id;
      const label = stickerLabel(sticker.id, lang());
      button.setAttribute('aria-label', `${label} :${sticker.id}:`);
      button.setAttribute('role', 'option');
      button.title = `:${sticker.id}: — ${label}`;
      button.append(customStickerImage(sticker.id, 'custom-sticker emoji-sticker'));
      button.addEventListener('click', () => onInsertSticker?.(sticker.id));
      grid.append(button);
    }
  }

  const cats = [...STICKER_CATEGORIES, { id: 'mine', en: 'My stickers', ar: 'ستيكراتي' }];
  for (const cat of cats) {
    const tab = el('button', 'emoji-tab sticker-tab', catLabel(cat));
    tab.type = 'button';
    tab.dataset.cat = cat.id;
    tab.setAttribute('aria-pressed', String(cat.id === activeCat));
    tab.title = `${cat.en} / ${cat.ar}`;
    tab.addEventListener('click', () => {
      activeCat = cat.id;
      for (const b of tabs.querySelectorAll('.emoji-tab')) b.setAttribute('aria-pressed', String(b === tab));
      renderGrid(search.value);
    });
    tabs.append(tab);
  }
  const createBtn = el('button', 'btn btn-quiet btn-sm', pickText(t, 'sticker.create'));
  createBtn.type = 'button';
  createBtn.addEventListener('click', () => onOpenStickerCreator?.());
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', pickText(t, 'composer.sticker'));
  menu.append(search, tabs, grid, createBtn);
  search.addEventListener('input', () => renderGrid(search.value));
  renderGrid();
  return { search, grid };
}

// Injected by room.js/server.js to avoid a circular import with emoji.js.
let stickerMenuDeps = null;
export function setStickerMenuDeps(deps) { stickerMenuDeps = deps; }

export async function renderMine(container, { t, toast, onSendCustomSticker } = {}) {
  container.replaceChildren(el('p', 'emoji-empty', pickText(t, 'sticker.mineLoading')));
  let mine = [];
  try { mine = await listCustomStickers(); } catch { mine = []; }
  container.replaceChildren();
  if (!mine.length) {
    container.append(el('p', 'emoji-empty', pickText(t, 'sticker.mineEmpty')));
    return;
  }
  for (const record of mine) {
    const wrap = el('div', 'custom-sticker-wrap');
    const button = el('button', 'emoji-choice custom-sticker-btn');
    button.type = 'button';
    button.setAttribute('aria-label', record.name);
    button.title = record.name;
    const url = await getCustomStickerUrl(record.id);
    button.append(customStickerImg(record, url));
    button.addEventListener('click', async () => {
      try {
        const { getCustomStickerBlob } = await import('./custom-stickers.js');
        const blob = await getCustomStickerBlob(record.id);
        if (!blob) throw new Error('missing');
        const file = new File([blob], `${record.id}.${(record.type || 'image/png').split('/')[1] || 'png'}`, { type: record.type || blob.type || 'image/png' });
        await onSendCustomSticker?.(file, record);
      } catch { toast?.(pickText(t, 'sticker.sendFailed'), 'error', 3000); }
    });
    const del = el('button', 'custom-sticker-del', '×');
    del.type = 'button';
    del.setAttribute('aria-label', pickText(t, 'sticker.delete'));
    del.title = pickText(t, 'sticker.delete');
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteCustomSticker(record.id);
      wrap.remove();
    });
    wrap.append(button, del);
    container.append(wrap);
  }
}

/* ---------------- Sticker creator dialog (shared) ---------------- */

export function openStickerCreator({ t, toast, onCreated } = {}) {
  let dialog = document.querySelector('#sticker-creator-dialog');
  if (dialog) { dialog.showModal?.(); return dialog; }
  dialog = el('dialog', 'sticker-creator-dialog');
  dialog.id = 'sticker-creator-dialog';
  dialog.setAttribute('aria-labelledby', 'sticker-creator-title');

  const title = el('h2', '', pickText(t, 'sticker.createTitle'));
  title.id = 'sticker-creator-title';
  const lead = el('p', 'muted', pickText(t, 'sticker.createLead'));
  const preview = el('div', 'sticker-preview');
  const previewImg = el('img', 'sticker-preview-img');
  previewImg.alt = '';
  preview.append(previewImg);
  const emptyPreview = el('span', 'emoji-empty', pickText(t, 'sticker.previewEmpty'));
  preview.append(emptyPreview);

  const fileInput = el('input', 'gif-input');
  fileInput.type = 'file';
  fileInput.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif';
  fileInput.setAttribute('aria-label', pickText(t, 'sticker.chooseFile'));
  const nameInput = el('input', 'emoji-search gif-input');
  nameInput.type = 'text';
  nameInput.placeholder = pickText(t, 'sticker.namePlaceholder');
  nameInput.setAttribute('aria-label', pickText(t, 'sticker.name'));
  nameInput.maxLength = 40;

  const errorBox = el('p', 'form-error', '');
  errorBox.hidden = true;
  const row = el('div', 'gif-row');
  const save = el('button', 'btn btn-primary btn-sm', pickText(t, 'sticker.saveLocal'));
  save.type = 'button';
  const close = el('button', 'btn btn-quiet btn-sm', pickText(t, 'log.close'));
  close.type = 'button';
  row.append(save, close);
  dialog.append(title, lead, preview, fileInput, nameInput, errorBox, row);
  document.body.append(dialog);

  let chosenBlob = null;
  let previewUrl = '';
  function showError(key) {
    errorBox.textContent = pickText(t, key);
    errorBox.hidden = false;
  }
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0] || null;
    const check = validateStickerFile(file || {});
    if (!file || !check.ok) {
      chosenBlob = null;
      previewImg.removeAttribute('src');
      emptyPreview.hidden = false;
      showError('sticker.invalidFile');
      return;
    }
    errorBox.hidden = true;
    chosenBlob = file;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    previewImg.src = previewUrl;
    previewImg.alt = cleanCustomStickerName(nameInput.value || file.name);
    emptyPreview.hidden = true;
    if (!nameInput.value) nameInput.value = cleanCustomStickerName(file.name.replace(/\.[^.]+$/, ''));
  });
  save.addEventListener('click', async () => {
    if (!chosenBlob) { showError('sticker.invalidFile'); return; }
    try {
      const record = await addCustomSticker({ name: nameInput.value, blob: chosenBlob, type: chosenBlob.type });
      toast?.(pickText(t, 'sticker.saved'), 'info', 2600);
      dialog.close();
      onCreated?.(record);
    } catch (error) {
      showError(error?.message === 'sticker-limit' ? 'sticker.limit' : error?.message === 'sticker-quota' ? 'sticker.quota' : 'sticker.saveFailed');
    }
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.showModal?.();
  return dialog;
}

export default { buildGifPanel, buildStickerMenu, setStickerMenuDeps, renderMine, openStickerCreator };
