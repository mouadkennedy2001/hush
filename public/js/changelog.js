import { t, getLanguage, onLanguageChange } from './i18n.js';
import { playSound } from './sounds.js';

// Renders the Log (changelog) dialog. Data comes from /api/changelog
// (public/changelog.json). Bilingual: entries carry En/Ar fields and the
// dialog re-renders when the language changes. Works on landing + room.
//
// v12.1 improvements (was just a clipped list, worst in Arabic RTL):
// - search + kind filter tabs (All / Updates / Fixes / Security / Features),
//   all labels localized via t() — Arabic in ar, English in en
// - cards wrap text anywhere, dates are isolated LTR, list scrolls inside
//   the dialog instead of overflowing/clipping the page
const SEEN_KEY = 'hush:changelog-seen';
let activeKind = 'all';
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

function kindLabel(kind) {
  const map = { update: 'log.filterUpdate', fix: 'log.filterFix', security: 'log.filterSecurity', feature: 'log.filterFeature' };
  return map[kind] ? t(map[kind]) : kind;
}

function ensureDialog() {
  let dialog = document.querySelector('#changelog-dialog');
  if (dialog) return dialog;
  dialog = el('dialog', 'changelog-dialog');
  dialog.id = 'changelog-dialog';
  dialog.setAttribute('aria-labelledby', 'changelog-title');
  dialog.innerHTML = `
    <div class="changelog-inner">
      <div class="dialog-head">
        <h2 id="changelog-title"></h2>
        <button class="icon-button dialog-close" type="button" data-close-changelog aria-label="Close">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <p class="muted changelog-lead"></p>
      <div class="changelog-tools">
        <input type="search" class="emoji-search changelog-search" aria-label="Search updates" />
        <div class="changelog-tabs" role="tablist"></div>
        <span class="changelog-count" aria-live="polite"></span>
      </div>
      <div class="changelog-list"></div>
    </div>`;
  document.body.append(dialog);
  dialog.querySelector('[data-close-changelog]').addEventListener('click', closeChangelog);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeChangelog(); });
  dialog.querySelector('.changelog-search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    void renderEntries(dialog);
  });
  return dialog;
}

function renderTitle(dialog) {
  const title = dialog.querySelector('#changelog-title');
  if (title) title.textContent = t('log.title');
  const lead = dialog.querySelector('.changelog-lead');
  if (lead) lead.textContent = t('log.lead');
  const close = dialog.querySelector('[data-close-changelog]');
  if (close) close.setAttribute('aria-label', t('log.close'));
  const search = dialog.querySelector('.changelog-search');
  if (search) {
    search.placeholder = t('log.search');
    search.setAttribute('aria-label', t('log.search'));
  }
  renderTabs(dialog);
  // Log buttons: Log (EN) / السجل (AR)
  for (const button of document.querySelectorAll('[data-open-log]')) {
    button.setAttribute('title', t('log.open'));
    button.setAttribute('aria-label', t('log.open'));
    const label = button.querySelector('[data-log-label]');
    if (label) label.textContent = t('log.open');
  }
}

function renderTabs(dialog) {
  const tabs = dialog.querySelector('.changelog-tabs');
  if (!tabs) return;
  tabs.replaceChildren();
  const filters = [
    { id: 'all', label: t('log.filterAll') },
    { id: 'update', label: t('log.filterUpdate') },
    { id: 'fix', label: t('log.filterFix') },
    { id: 'security', label: t('log.filterSecurity') },
    { id: 'feature', label: t('log.filterFeature') }
  ];
  for (const f of filters) {
    const tab = el('button', 'emoji-tab', f.label);
    tab.type = 'button';
    tab.dataset.kind = f.id;
    tab.setAttribute('aria-pressed', String(activeKind === f.id));
    tab.addEventListener('click', () => {
      activeKind = f.id;
      for (const b of tabs.querySelectorAll('.emoji-tab')) b.setAttribute('aria-pressed', String(b === tab));
      void renderEntries(dialog);
    });
    tabs.append(tab);
  }
}

async function loadEntries() {
  try {
    const res = await fetch('/api/changelog', { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.entries) ? data.entries : [];
  } catch { return []; }
}

async function renderEntries(dialog) {
  const list = dialog.querySelector('.changelog-list');
  const count = dialog.querySelector('.changelog-count');
  const entries = await loadEntries();
  const q = searchQuery.trim().toLowerCase();
  const langSuffix = getLanguage() === 'ar' ? 'Ar' : 'En';
  const filtered = entries.filter((entry) => {
    if (activeKind !== 'all' && (entry.kind || 'update') !== activeKind) return false;
    if (!q) return true;
    const hay = `${pick(entry, 'title', '')} ${(entry[`points${langSuffix}`] || entry.points || []).join(' ')}`.toLowerCase();
    return hay.includes(q);
  });
  if (count) count.textContent = t('log.results', { count: String(filtered.length) });
  list.replaceChildren();
  if (!entries.length) {
    list.append(el('p', 'muted', t('log.empty')));
    return;
  }
  if (!filtered.length) {
    list.append(el('p', 'muted', t('log.empty')));
    return;
  }
  for (const entry of filtered) {
    const card = el('article', 'changelog-card');
    const head = el('div', 'changelog-head');
    head.append(
      el('span', 'changelog-date', entry.date || ''),
      el('span', `changelog-tag is-${entry.kind || 'update'}`, pick(entry, 'kind', kindLabel(entry.kind || 'update')))
    );
    card.append(head);
    card.append(el('h3', '', pick(entry, 'title', entry.title || '')));
    const ul = el('ul', 'changelog-points');
    const points = entry[`points${langSuffix}`] || entry.points || [];
    for (const point of points) ul.append(el('li', '', point));
    card.append(ul);
    list.append(card);
  }
}

export async function openChangelog() {
  const dialog = ensureDialog();
  renderTitle(dialog);
  const list = dialog.querySelector('.changelog-list');
  list.replaceChildren(el('p', 'muted', t('log.loading')));
  playSound('click', { force: true });
  await renderEntries(dialog);
  try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch {}
  document.querySelectorAll('[data-log-badge]').forEach((b) => { b.hidden = true; });
  if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
  else dialog.setAttribute('open', '');
}

export function closeChangelog() {
  const dialog = document.querySelector('#changelog-dialog');
  if (!dialog) return;
  if (typeof dialog.close === 'function') { if (dialog.open) dialog.close(); }
  else dialog.removeAttribute('open');
}

export function initChangelog() {
  renderTitle(ensureDialog());
  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-open-log]');
    if (!button) return;
    event.preventDefault();
    openChangelog();
  });
  onLanguageChange(() => {
    renderTitle(ensureDialog());
    const dialog = document.querySelector('#changelog-dialog');
    if (dialog?.open) void renderEntries(dialog);
  });
  (async () => {
    try {
      const seen = Number(localStorage.getItem(SEEN_KEY) || 0);
      const entries = await loadEntries();
      const latest = entries[0]?.ts || 0;
      document.querySelectorAll('[data-log-badge]').forEach((b) => { b.hidden = !(entries.length && latest > seen); });
    } catch {}
  })();
}
