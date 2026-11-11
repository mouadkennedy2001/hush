import { t, locale, onLanguageChange } from './i18n.js';
import { playSound } from './sounds.js';

// Server-backed feedback board.
//
// Two separate entry buttons share one dialog:
//   [data-open-bug-report]      -> "Report a bug"   (errors / broken things)
//   [data-open-feature-suggest] -> "Suggest a feature" (ideas + voting)
//
// The board lives on the server (GET/POST /api/feedback*), so votes are
// shared by every visitor. Suggestions collect votes for 30 days; at review
// the most-voted gets a check mark and is approved, the rest get a 2-day grace period
// and are deleted. Bug reports stay until the maintainer marks them fixed.
//
// All user-submitted text is inserted with textContent — never innerHTML.

const DEVICE_KEY = 'hush:device';
const NAME_KEY = 'hush:name';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TITLE = 140;
const MAX_DETAILS = 4000;
const MAX_CODE = 4000;
const MAX_AUTHOR = 32;

const state = {
  data: null,
  tab: 'suggestions',
  mode: 'suggestion',
  loading: false,
  busy: false
};

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

let memoryVoterId = '';

function getVoterId() {
  if (memoryVoterId) return memoryVoterId;
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[a-zA-Z0-9-]{8,64}$/.test(id)) {
      id = window.crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    memoryVoterId = id;
    return id;
  } catch {
    // Storage blocked (private mode): keep one id for this page session so
    // votes still toggle instead of creating a new voter on every request.
    memoryVoterId = `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return memoryVoterId;
  }
}

function getSavedName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}

function formatDate(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return '';
  try {
    return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(new Date(time));
  } catch {
    return new Date(time).toISOString().slice(0, 10);
  }
}

function daysUntil(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return 0;
  return Math.max(0, Math.ceil((time - Date.now()) / DAY_MS));
}

function errorText(code) {
  const map = {
    'title-too-short': 'feedback.errorTitle',
    'details-too-short': 'feedback.errorDetails',
    'voter-required': 'feedback.errorVoter',
    duplicate: 'feedback.errorDuplicate',
    full: 'feedback.errorFull',
    'vote-closed': 'feedback.errorVoteClosed',
    'not-found': 'feedback.errorNotFound',
    'rate-limited': 'feedback.errorRate',
    'admin-disabled': 'feedback.errorAdmin',
    forbidden: 'feedback.errorAdmin'
  };
  return t(map[code] || 'feedback.errorGeneric');
}

function ensureDialog() {
  let dialog = document.querySelector('#feedback-dialog');
  if (dialog) return dialog;

  dialog = el('dialog', 'changelog-dialog feedback-dialog');
  dialog.id = 'feedback-dialog';
  dialog.setAttribute('aria-labelledby', 'feedback-title');
  // Static skeleton only — every piece of user text is rendered later with
  // textContent, so this innerHTML never contains untrusted data.
  dialog.innerHTML = `
    <div class="changelog-inner feedback-inner">
      <div class="dialog-head">
        <h2 id="feedback-title"></h2>
        <button class="icon-button dialog-close" type="button" data-close-feedback aria-label="Close">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <p class="muted changelog-lead feedback-lead"></p>
      <p class="feedback-cycle"></p>
      <div class="feedback-tabs" role="tablist"></div>
      <div class="feedback-list" aria-live="polite"></div>
      <form class="feedback-form" novalidate>
        <h3 class="feedback-form-title"></h3>
        <label class="fb-field">
          <span class="fb-label feedback-title-label"></span>
          <input class="fb-input feedback-title-input" type="text" maxlength="${MAX_TITLE}" minlength="4" autocomplete="off" required />
        </label>
        <label class="fb-field">
          <span class="fb-label feedback-details-label"></span>
          <textarea class="fb-textarea feedback-details-input" maxlength="${MAX_DETAILS}" minlength="10" rows="3" required></textarea>
        </label>
        <label class="fb-field feedback-code-field" hidden>
          <span class="fb-label feedback-code-label"></span>
          <textarea class="fb-textarea feedback-code-input" maxlength="${MAX_CODE}" rows="3" spellcheck="false"></textarea>
        </label>
        <label class="fb-field feedback-author-field">
          <span class="fb-label feedback-author-label"></span>
          <input class="fb-input feedback-author-input" type="text" maxlength="${MAX_AUTHOR}" autocomplete="nickname" />
        </label>
        <div class="feedback-form-actions">
          <span class="feedback-form-status" role="status" aria-live="polite"></span>
          <button class="btn btn-primary btn-sm feedback-submit" type="submit"></button>
        </div>
      </form>
    </div>`;

  document.body.append(dialog);
  dialog.querySelector('[data-close-feedback]').addEventListener('click', closeFeedback);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeFeedback();
  });
  dialog.querySelector('.feedback-tabs').addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-feedback-tab]');
    if (!button) return;
    setMode(button.dataset.feedbackTab === 'reports' ? 'report' : 'suggestion');
  });
  dialog.querySelector('.feedback-list').addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-feedback-vote]');
    if (!button) return;
    event.preventDefault();
    void toggleVote(button.dataset.feedbackVote);
  });
  dialog.querySelector('.feedback-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void submitForm();
  });
  return dialog;
}

function setStatus(message, kind = '') {
  const status = ensureDialog().querySelector('.feedback-form-status');
  if (!status) return;
  status.textContent = message || '';
  status.dataset.kind = kind;
}

function renderButtons() {
  for (const button of document.querySelectorAll('[data-open-bug-report]')) {
    button.setAttribute('title', t('feedback.openBug'));
    button.setAttribute('aria-label', t('feedback.openBug'));
    const label = button.querySelector('[data-bug-label]');
    if (label) label.textContent = t('feedback.openBug');
  }
  for (const button of document.querySelectorAll('[data-open-feature-suggest]')) {
    button.setAttribute('title', t('feedback.openFeature'));
    button.setAttribute('aria-label', t('feedback.openFeature'));
    const label = button.querySelector('[data-feature-label]');
    if (label) label.textContent = t('feedback.openFeature');
  }
}

function renderChrome(dialog = ensureDialog()) {
  const isBug = state.mode === 'report';
  dialog.querySelector('#feedback-title').textContent = isBug ? t('feedback.titleBug') : t('feedback.titleFeature');
  dialog.querySelector('.feedback-lead').textContent = isBug ? t('feedback.leadBug') : t('feedback.leadFeature');
  dialog.querySelector('[data-close-feedback]')?.setAttribute('aria-label', t('feedback.close'));

  const tabs = dialog.querySelector('.feedback-tabs');
  tabs.replaceChildren();
  const counts = {
    suggestions: state.data?.suggestions?.length || 0,
    reports: state.data?.reports?.length || 0
  };
  for (const [id, key] of [['suggestions', 'feedback.tabSuggestions'], ['reports', 'feedback.tabReports']]) {
    const tab = el('button', 'emoji-tab', t(key, { count: String(counts[id]) }));
    tab.type = 'button';
    tab.dataset.feedbackTab = id;
    tab.setAttribute('aria-pressed', String(state.tab === id));
    tab.setAttribute('role', 'tab');
    tabs.append(tab);
  }

  const titleLabel = dialog.querySelector('.feedback-title-label');
  titleLabel.textContent = isBug ? t('feedback.reportTitleLabel') : t('feedback.suggestTitleLabel');
  const titleInput = dialog.querySelector('.feedback-title-input');
  titleInput.placeholder = isBug ? t('feedback.reportTitlePlaceholder') : t('feedback.suggestTitlePlaceholder');
  titleInput.setAttribute('aria-label', titleLabel.textContent);

  const detailsLabel = dialog.querySelector('.feedback-details-label');
  detailsLabel.textContent = isBug ? t('feedback.reportDetailsLabel') : t('feedback.suggestDetailsLabel');
  const detailsInput = dialog.querySelector('.feedback-details-input');
  detailsInput.placeholder = isBug ? t('feedback.reportDetailsPlaceholder') : t('feedback.suggestDetailsPlaceholder');
  detailsInput.setAttribute('aria-label', detailsLabel.textContent);

  const codeField = dialog.querySelector('.feedback-code-field');
  codeField.hidden = !isBug;
  const codeLabel = dialog.querySelector('.feedback-code-label');
  codeLabel.textContent = t('feedback.codeLabel');
  const codeInput = dialog.querySelector('.feedback-code-input');
  codeInput.placeholder = t('feedback.codePlaceholder');
  codeInput.setAttribute('aria-label', codeLabel.textContent);

  dialog.querySelector('.feedback-author-label').textContent = t('feedback.authorLabel');
  const authorInput = dialog.querySelector('.feedback-author-input');
  authorInput.placeholder = t('feedback.authorPlaceholder');
  authorInput.setAttribute('aria-label', t('feedback.authorLabel'));

  dialog.querySelector('.feedback-form-title').textContent = isBug ? t('feedback.formBug') : t('feedback.formFeature');
  dialog.querySelector('.feedback-submit').textContent = isBug ? t('feedback.submitBug') : t('feedback.submitFeature');

  renderCycle(dialog);
}

function renderCycle(dialog = ensureDialog()) {
  const node = dialog.querySelector('.feedback-cycle');
  const cycle = state.data?.cycle;
  if (!cycle) { node.textContent = ''; node.hidden = true; return; }
  node.hidden = false;
  node.textContent = t('feedback.cycleNote', {
    days: String(cycle.days),
    grace: String(cycle.graceDays)
  });
}

function statusBadge(item, isBug) {
  if (isBug) {
    return item.status === 'fixed'
      ? el('span', 'fb-badge is-fixed', t('feedback.fixed'))
      : el('span', 'fb-badge is-open', t('feedback.open'));
  }
  if (item.status === 'approved') return el('span', 'fb-badge is-approved', t('feedback.approved'));
  if (item.status === 'pending-delete') {
    return el('span', 'fb-badge is-pending', t('feedback.deleteIn', { days: String(daysUntil(item.deleteAt)) }));
  }
  if (item.checked) return el('span', 'fb-badge is-chosen', t('feedback.chosen'));
  return el('span', 'fb-badge is-open', t('feedback.open'));
}

function renderSuggestion(item) {
  const card = el('article', 'fb-card');
  const vote = el('button', 'fb-vote');
  vote.type = 'button';
  vote.dataset.feedbackVote = item.id;
  vote.setAttribute('aria-pressed', String(Boolean(item.voted)));
  vote.setAttribute('title', item.voted ? t('feedback.voted') : t('feedback.vote'));
  vote.setAttribute('aria-label', `${item.voted ? t('feedback.voted') : t('feedback.vote')} — ${item.title}`);
  vote.append(el('span', 'fb-vote-count', String(item.voteCount)));
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'fb-vote-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 19V5M5 12l7-7 7 7');
  icon.append(path);
  vote.prepend(icon);

  const main = el('div', 'fb-card-main');
  const title = el('h3', 'fb-card-title');
  title.append(el('span', 'fb-card-title-text', item.title));
  if (item.checked) {
    const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    check.setAttribute('class', 'fb-check');
    check.setAttribute('viewBox', '0 0 24 24');
    check.setAttribute('fill', 'none');
    check.setAttribute('stroke', 'currentColor');
    check.setAttribute('stroke-width', '3');
    check.setAttribute('stroke-linecap', 'round');
    check.setAttribute('stroke-linejoin', 'round');
    check.setAttribute('role', 'img');
    check.setAttribute('aria-label', t('feedback.chosen'));
    const checkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    checkPath.setAttribute('d', 'M20 6 9 17l-5-5');
    check.append(checkPath);
    title.append(check);
  }
  main.append(title);
  main.append(el('p', 'fb-card-details', item.details));
  const meta = el('div', 'fb-card-meta');
  meta.append(el('span', 'fb-author', item.author || t('feedback.anonymous')));
  meta.append(el('span', 'fb-date', formatDate(item.createdAt)));
  if (item.status === 'open' && state.data?.cycle) {
    const reviewAt = Number(item.createdAt) + Number(state.data.cycle.days) * DAY_MS;
    meta.append(el('span', 'fb-review', t('feedback.reviewIn', { days: String(daysUntil(reviewAt)) })));
  }
  main.append(meta);

  card.append(vote, main, statusBadge(item, false));
  return card;
}

function renderReport(item) {
  const card = el('article', 'fb-card fb-report');
  const main = el('div', 'fb-card-main');
  main.append(el('h3', 'fb-card-title', item.title));
  main.append(el('p', 'fb-card-details', item.details));
  const meta = el('div', 'fb-card-meta');
  meta.append(el('span', 'fb-author', item.author || t('feedback.anonymous')));
  meta.append(el('span', 'fb-date', formatDate(item.createdAt)));
  main.append(meta);
  if (item.code) {
    const details = el('details', 'fb-code');
    details.append(el('summary', '', t('feedback.showCode')));
    details.append(el('pre', 'fb-code-body', item.code));
    main.append(details);
  }
  card.append(main, statusBadge(item, true));
  return card;
}

function renderList(dialog = ensureDialog()) {
  const list = dialog.querySelector('.feedback-list');
  list.replaceChildren();
  if (state.loading) {
    list.append(el('p', 'muted fb-empty', t('feedback.loading')));
    return;
  }
  if (!state.data) {
    list.append(el('p', 'muted fb-empty', t('feedback.errorGeneric')));
    return;
  }
  const isBug = state.tab === 'reports';
  const items = isBug ? state.data.reports || [] : state.data.suggestions || [];
  if (!items.length) {
    list.append(el('p', 'muted fb-empty', isBug ? t('feedback.emptyReports') : t('feedback.emptySuggestions')));
    return;
  }
  for (const item of items) {
    list.append(isBug ? renderReport(item) : renderSuggestion(item));
  }
}

function setMode(mode, { reset = false } = {}) {
  state.mode = mode === 'report' ? 'report' : 'suggestion';
  state.tab = state.mode === 'report' ? 'reports' : 'suggestions';
  const dialog = ensureDialog();
  if (reset) {
    dialog.querySelector('.feedback-form').reset();
    setStatus('');
  }
  const author = dialog.querySelector('.feedback-author-input');
  if (author && !author.value) author.value = getSavedName();
  renderChrome(dialog);
  renderList(dialog);
}

async function loadBoard(dialog = ensureDialog()) {
  state.loading = true;
  renderList(dialog);
  try {
    const res = await fetch(`/api/feedback?voterId=${encodeURIComponent(getVoterId())}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('http');
    state.data = await res.json();
  } catch {
    state.data = null;
  } finally {
    state.loading = false;
  }
  renderChrome(dialog);
  renderList(dialog);
}

async function toggleVote(id) {
  if (!id || state.busy) return;
  state.busy = true;
  try {
    const res = await fetch('/api/feedback/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, voterId: getVoterId() })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(errorText(data.error), 'error');
      return;
    }
    playSound('click', { force: true });
    await loadBoard();
  } catch {
    setStatus(errorText(''), 'error');
  } finally {
    state.busy = false;
  }
}

async function submitForm() {
  if (state.busy) return;
  const dialog = ensureDialog();
  const title = dialog.querySelector('.feedback-title-input').value.trim();
  const details = dialog.querySelector('.feedback-details-input').value.trim();
  const code = dialog.querySelector('.feedback-code-input').value.trim();
  const author = dialog.querySelector('.feedback-author-input').value.trim();
  if (title.length < 4) { setStatus(t('feedback.errorTitle'), 'error'); return; }
  if (details.length < 10) { setStatus(t('feedback.errorDetails'), 'error'); return; }

  const isBug = state.mode === 'report';
  const endpoint = isBug ? '/api/feedback/reports' : '/api/feedback/suggestions';
  const body = { title, details, author, voterId: getVoterId() };
  if (isBug && code) body.code = code;

  state.busy = true;
  const submit = dialog.querySelector('.feedback-submit');
  submit.disabled = true;
  setStatus(t('feedback.sending'));
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(errorText(data.error), 'error');
      return;
    }
    dialog.querySelector('.feedback-form').reset();
    dialog.querySelector('.feedback-author-input').value = getSavedName();
    setStatus(isBug ? t('feedback.sentBug') : t('feedback.sentFeature'), 'success');
    playSound('message', { force: true });
    await loadBoard();
  } catch {
    setStatus(errorText(''), 'error');
  } finally {
    state.busy = false;
    submit.disabled = false;
  }
}

export function openFeedback(mode = 'suggestion') {
  const dialog = ensureDialog();
  setMode(mode, { reset: true });
  setStatus('');
  playSound('click', { force: true });
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
  void loadBoard(dialog);
}

export function closeFeedback() {
  const dialog = document.querySelector('#feedback-dialog');
  if (!dialog) return;
  if (typeof dialog.close === 'function') {
    if (dialog.open) dialog.close();
  } else {
    dialog.removeAttribute('open');
  }
}

export function initFeedback() {
  renderButtons();
  ensureDialog();
  document.addEventListener('click', (event) => {
    const bug = event.target?.closest?.('[data-open-bug-report]');
    if (bug) {
      event.preventDefault();
      openFeedback('report');
      return;
    }
    const feature = event.target?.closest?.('[data-open-feature-suggest]');
    if (feature) {
      event.preventDefault();
      openFeedback('suggestion');
    }
  });
  onLanguageChange(() => {
    renderButtons();
    const dialog = document.querySelector('#feedback-dialog');
    if (!dialog) return;
    renderChrome(dialog);
    renderList(dialog);
  });
}

export default { initFeedback, openFeedback, closeFeedback };
