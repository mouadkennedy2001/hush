import { t, getLanguage, onLanguageChange } from './i18n.js';
import { playSound } from './sounds.js';

// Dedicated Libraries log (mic + PING OP) — separate from the main Log.
// Data comes from /api/libraries-changelog (public/libraries-changelog.json).
// Bilingual: entries carry En/Ar fields and re-render on language change.
// Filter tabs: All / mic / ping-op. Search filters titles + points.
const SEEN_KEY = 'hush:libraries-seen';
let activeFilter = 'all';
let searchQuery = '';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function pick(entry, base, fallback) {
  const lang = getLanguage();
  return entry[`${base}${lang === 'ar' ? 'Ar' : 'En'}`] ?? entry[base] ?? fallback ?? '';
}

function libraryLabel(lib) {
  if (lib === 'ping-op') return getLanguage() === 'ar' ? 'PING OP — تحسين البنق' : 'PING OP — Ping Optimizer';
  if (lib === 'giphy') return getLanguage() === 'ar' ? 'Giphy — صور GIF' : 'Giphy — GIF search';
  return getLanguage() === 'ar' ? 'mic — المايك' : 'mic — Microphone';
}

function ensureDialog() {
  let dialog = document.querySelector('#libraries-dialog');
  if (dialog) return dialog;
  dialog = el('dialog', 'changelog-dialog');
  dialog.id = 'libraries-dialog';
  dialog.setAttribute('aria-labelledby', 'libraries-title');
  dialog.innerHTML = `
    <div class="changelog-inner">
      <div class="dialog-head">
        <h2 id="libraries-title"></h2>
        <button class="icon-button dialog-close" type="button" data-close-libraries aria-label="Close">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <p class="muted changelog-lead"></p>
      <div class="libraries-tools">
        <div class="libraries-tabs" role="tablist"></div>
        <input type="search" class="emoji-search libraries-search" aria-label="Search libraries" />
      </div>
      <div class="changelog-list"></div>
    </div>`;
  document.body.append(dialog);
  dialog.querySelector('[data-close-libraries]').addEventListener('click', closeLibraries);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeLibraries(); });
  return dialog;
}

function renderTitle(dialog) {
  const title = dialog.querySelector('#libraries-title');
  if (title) title.textContent = t('libraries.title');
  const lead = dialog.querySelector('.changelog-lead');
  if (lead) lead.textContent = t('libraries.lead');
  const close = dialog.querySelector('[data-close-libraries]');
  if (close) close.setAttribute('aria-label', t('log.close'));
  const search = dialog.querySelector('.libraries-search');
  if (search) {
    search.placeholder = t('libraries.search');
    search.setAttribute('aria-label', t('libraries.search'));
  }
  for (const button of document.querySelectorAll('[data-open-libraries-log]')) {
    button.setAttribute('title', t('libraries.open'));
    button.setAttribute('aria-label', t('libraries.open'));
    const label = button.querySelector('[data-libraries-label]');
    if (label) label.textContent = t('libraries.open');
  }
}

function renderTabs(dialog) {
  const tabs = dialog.querySelector('.libraries-tabs');
  if (!tabs) return;
  tabs.replaceChildren();
  const filters = [
    { id: 'all', label: t('libraries.all') },
    { id: 'mic', label: 'mic' },
    { id: 'ping-op', label: getLanguage() === 'ar' ? 'PING OP — تحسين البنق' : 'PING OP' },
    { id: 'giphy', label: 'Giphy' }
  ];
  for (const f of filters) {
    const tab = el('button', 'emoji-tab', f.label);
    tab.type = 'button';
    tab.dataset.filter = f.id;
    tab.setAttribute('aria-pressed', String(activeFilter === f.id));
    tab.addEventListener('click', () => {
      activeFilter = f.id;
      for (const b of tabs.querySelectorAll('.emoji-tab')) b.setAttribute('aria-pressed', String(b === tab));
      void renderEntries(dialog);
    });
    tabs.append(tab);
  }
}

async function loadEntries() {
  try {
    const res = await fetch('/api/libraries-changelog', { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.entries) ? data.entries : [];
  } catch { return []; }
}

async function renderEntries(dialog) {
  const list = dialog.querySelector('.changelog-list');
  const entries = await loadEntries();
  const q = searchQuery.trim().toLowerCase();
  const filtered = entries.filter((e) => {
    if (activeFilter !== 'all' && e.library !== activeFilter) return false;
    if (!q) return true;
    const hay = `${pick(e, 'title', '')} ${(e[`points${getLanguage() === 'ar' ? 'Ar' : 'En'}`] || []).join(' ')}`.toLowerCase();
    return hay.includes(q);
  });
  list.replaceChildren();
  if (!filtered.length) {
    list.append(el('p', 'muted', t('log.empty')));
    return;
  }
  for (const entry of filtered) {
    const card = el('article', 'changelog-card');
    const head = el('div', 'changelog-head');
    head.append(
      el('span', 'changelog-date', entry.date || ''),
      el('span', `changelog-tag is-${entry.kind || 'update'}`, `${libraryLabel(entry.library)} · v${entry.version || ''}`)
    );
    card.append(head);
    card.append(el('h3', '', pick(entry, 'title', entry.title || '')));
    const ul = el('ul', 'changelog-points');
    const points = entry[`points${getLanguage() === 'ar' ? 'Ar' : 'En'}`] || entry.points || [];
    for (const point of points) ul.append(el('li', '', point));
    card.append(ul);
    list.append(card);
  }
}

export async function openLibraries() {
  const dialog = ensureDialog();
  renderTitle(dialog);
  renderTabs(dialog);
  const list = dialog.querySelector('.changelog-list');
  list.replaceChildren(el('p', 'muted', t('log.loading')));
  playSound('click', { force: true });
  await renderEntries(dialog);
  try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch {}
  document.querySelectorAll('[data-libraries-badge]').forEach((b) => { b.hidden = true; });
  if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
  else dialog.setAttribute('open', '');
}

export function closeLibraries() {
  const dialog = document.querySelector('#libraries-dialog');
  if (!dialog) return;
  if (typeof dialog.close === 'function') { if (dialog.open) dialog.close(); }
  else dialog.removeAttribute('open');
}

export function initLibraries() {
  renderTitle(ensureDialog());
  const dialog = ensureDialog();
  const search = dialog.querySelector('.libraries-search');
  if (search) search.addEventListener('input', () => { searchQuery = search.value; void renderEntries(dialog); });
  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-open-libraries-log]');
    if (!button) return;
    event.preventDefault();
    openLibraries();
  });
  onLanguageChange(() => {
    renderTitle(ensureDialog());
    renderTabs(ensureDialog());
    const d = document.querySelector('#libraries-dialog');
    if (d?.open) void renderEntries(d);
  });
  (async () => {
    try {
      const seen = Number(localStorage.getItem(SEEN_KEY) || 0);
      const entries = await loadEntries();
      const latest = entries[0]?.ts || 0;
      document.querySelectorAll('[data-libraries-badge]').forEach((b) => { b.hidden = !(entries.length && latest > seen); });
    } catch {}
  })();
}
