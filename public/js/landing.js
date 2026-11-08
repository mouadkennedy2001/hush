import { initI18n, onLanguageChange, t } from './i18n.js';
import { initTheme } from './theme.js';
import { startPing } from './ping.js';
import { initChangelog } from './changelog.js';
import { initLibraries } from './libraries-log.js';
import { CUSTOM_EMOJIS, customEmojiImage } from './emoji.js';
import { fetchServers, createServer, serverIconUrl, serverUrl, inviteUrl, lookupInvite } from './servers.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const toastRegion = $('#landing-toasts');
const landingError = $('#landing-error');
const joinDialog = $('#join-dialog');
const joinForm = $('#join-code-form');
const joinInput = $('#join-code-input');
const joinError = $('#join-dialog-error');
const description = $('meta[name="description"]');

initI18n();
initTheme();
startPing();
initChangelog();
initLibraries();
applyPageMeta();
onLanguageChange(applyPageMeta);

function applyPageMeta() {
  document.title = t('meta.landingTitle');
  if (description) description.setAttribute('content', t('meta.landingDescription'));
}

async function refreshStats() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    const rooms = document.querySelector('[data-rooms-online]');
    if (rooms) rooms.textContent = String(data.rooms ?? 0);
    const uptime = document.querySelector('[data-uptime]');
    if (uptime && Number.isFinite(data.uptime)) {
      const minutes = Math.floor(data.uptime / 60);
      uptime.textContent = minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${minutes}m`;
    }
  } catch {
    // Stats are decorative; ignore failures.
  }
}

refreshStats();
setInterval(refreshStats, 10000);

/* ---------------- Servers ---------------- */

const serverGrid = $('#server-grid');
const serverEmpty = $('#server-empty');
const serverDialog = $('#server-dialog');
const serverForm = $('#server-form');
const serverNameInput = $('#server-name-input');
const serverIconPicker = $('#server-icon-picker');
const serverDialogError = $('#server-dialog-error');
let selectedIcon = 'star';

function renderServers(servers, query = '') {
  if (!serverGrid) return;
  serverGrid.replaceChildren();
  // Only servers the visitor added (created or joined) are shown here.
  // On the API side, those are exactly the summaries carrying an invite code
  // for this device — strangers' servers (inviteCode null) never render.
  const mine = (servers || []).filter((s) => s.inviteCode || s.isOwner);
  const q = String(query ?? '').trim().toLowerCase();
  const visible = q
    ? mine.filter((s) => s.name.toLowerCase().includes(q) || String(s.description ?? '').toLowerCase().includes(q))
    : mine;
  if (!visible.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.id = 'server-empty';
    p.textContent = servers?.length && !mine.length ? t('server.onlyMyServers') : t('server.empty');
    serverGrid.append(p);
    return;
  }
  for (const server of visible) {
    const card = document.createElement('article');
    card.className = 'server-card';
    const icon = document.createElement('img');
    icon.src = serverIconUrl(server);
    icon.alt = server.iconEmojiId ? `:${server.iconEmojiId}:` : '';
    icon.className = 'custom-emoji server-card-icon';
    icon.width = 44; icon.height = 44;
    const body = document.createElement('div');
    body.className = 'server-card-body';
    const title = document.createElement('h3');
    title.textContent = server.name;
    const meta = document.createElement('p');
    meta.className = 'muted';
    meta.textContent = t('server.members', { count: server.memberCount ?? 1 }) + ' · ' + (server.channels?.length ?? 0) + ' ' + t('server.channels');
    body.append(title, meta);
    if (server.description) {
      const desc = document.createElement('p');
      desc.className = 'server-description';
      desc.textContent = server.description;
      body.append(desc);
    }
    if (server.isOwner) {
      const mine = document.createElement('span');
      mine.className = 'host-badge';
      mine.textContent = t('server.myServer');
      body.append(mine);
    }
    card.append(icon, body);
    const open = document.createElement('a');
    open.className = 'btn btn-primary btn-sm';
    open.href = serverUrl(server);
    open.textContent = t('server.open');
    card.append(open);
    const copy = document.createElement('button');
    copy.className = 'btn btn-quiet btn-sm';
    copy.type = 'button';
    copy.textContent = t('server.copyInvite');
    copy.title = t('server.copyInvite');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(inviteUrl(server)); toast(t('toast.inviteCopied')); }
      catch { toast(t('toast.copyFailed'), 4200); }
    });
    card.append(copy);
    serverGrid.append(card);
  }
}

async function refreshServers() {
  try {
    renderServers(await fetchServers(), $('#server-search-input')?.value ?? '');
  } catch {
    if (serverEmpty) serverEmpty.textContent = t('server.empty');
  }
}

refreshServers();
setInterval(refreshServers, 15000);
let serverSearchTimer = null;
$('#server-search-input')?.addEventListener('input', () => {
  clearTimeout(serverSearchTimer);
  serverSearchTimer = setTimeout(async () => {
    try { renderServers(await fetchServers(), $('#server-search-input').value); }
    catch { /* keep previous list */ }
  }, 220);
});

if (serverIconPicker) {
  for (const emoji of CUSTOM_EMOJIS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'server-icon-choice';
    btn.dataset.icon = emoji.id;
    btn.title = `:${emoji.id}:`;
    btn.setAttribute('aria-label', `:${emoji.id}:`);
    btn.append(customEmojiImage(emoji.id, 'custom-emoji custom-emoji-sm'));
    if (emoji.id === selectedIcon) btn.classList.add('is-selected');
    btn.addEventListener('click', () => {
      selectedIcon = emoji.id;
      serverIconPicker.querySelectorAll('.server-icon-choice').forEach((b) => b.classList.toggle('is-selected', b === btn));
    });
    serverIconPicker.append(btn);
  }
}

function openServerDialog() {
  if (!serverDialog) return;
  if (serverDialogError) serverDialogError.hidden = true;
  if (typeof serverDialog.showModal === 'function') serverDialog.showModal();
  else serverDialog.setAttribute('open', '');
  setTimeout(() => serverNameInput?.focus(), 40);
}

function closeServerDialog() {
  if (!serverDialog) return;
  if (typeof serverDialog.close === 'function') serverDialog.close();
  else serverDialog.removeAttribute('open');
}

document.querySelectorAll('[data-open-server]').forEach((b) => b.addEventListener('click', openServerDialog));
document.querySelectorAll('[data-close-server]').forEach((b) => b.addEventListener('click', closeServerDialog));
if (serverDialog) serverDialog.addEventListener('click', (e) => { if (e.target === serverDialog) closeServerDialog(); });

if (serverForm) {
  serverForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = serverNameInput?.value.trim();
    if (!name) { serverNameInput?.focus(); return; }
    if (serverDialogError) serverDialogError.hidden = true;
    try {
      let ownerName = '';
      try { ownerName = localStorage.getItem('hush:name') || ''; } catch {}
      const server = await createServer({ name, iconEmojiId: selectedIcon, ownerName });
      toast(t('server.created'));
      closeServerDialog();
      window.location.href = serverUrl(server);
    } catch {
      if (serverDialogError) { serverDialogError.textContent = t('server.createFailed'); serverDialogError.hidden = false; }
    }
  });
}

// Join a server with an invite code (from the send-invite link / code).
const inviteForm = $('#invite-form');
const inviteInput = $('#invite-input');
const inviteError = $('#invite-error');
if (inviteForm) {
  inviteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = inviteInput?.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) { inviteInput?.focus(); return; }
    if (inviteError) inviteError.hidden = true;
    const server = await lookupInvite(code);
    if (!server) {
      if (inviteError) { inviteError.textContent = t('server.inviteNotFound'); inviteError.hidden = false; }
      return;
    }
    window.location.href = `/s/${server.id}?invite=${encodeURIComponent(code)}`;
  });
}

function toast(message, timeout = 3200) {
  if (!toastRegion) return;
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  toastRegion.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity 180ms ease';
    setTimeout(() => node.remove(), 200);
  }, timeout);
}

function showLandingError(message) {
  if (!landingError) return;
  landingError.textContent = message;
  landingError.hidden = !message;
  if (message) toast(message, 4200);
}

function normalizeCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatCode(value) {
  const code = normalizeCode(value);
  if (code.length <= 3) return code;
  return `${code.slice(0, 3)}-${code.slice(3, 12)}`;
}

function navigateToRoom(code) {
  window.location.href = `/r/${code}`;
}

async function createRoom(button) {
  showLandingError('');
  button.disabled = true;
  button.textContent = t('landing.opening');

  try {
    const response = await fetch('/api/rooms', { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.code) {
      throw new Error(
        response.status === 429 ? t('landing.rateLimited') : t('landing.createFailed')
      );
    }
    navigateToRoom(data.code);
  } catch (error) {
    button.disabled = false;
    button.textContent = t('landing.openRoom');
    showLandingError(error.message || t('landing.createFailed'));
  }
}

$$('[data-create-room]').forEach((button) => {
  button.addEventListener('click', () => createRoom(button));
});

function openJoinDialog() {
  if (!joinDialog) return;
  if (joinError) joinError.hidden = true;
  if (joinInput) joinInput.value = '';
  if (typeof joinDialog.showModal === 'function') joinDialog.showModal();
  else joinDialog.setAttribute('open', '');
  setTimeout(() => joinInput?.focus(), 40);
}

function closeJoinDialog() {
  if (!joinDialog) return;
  if (typeof joinDialog.close === 'function') joinDialog.close();
  else joinDialog.removeAttribute('open');
}

$$('[data-open-join]').forEach((button) => {
  button.addEventListener('click', openJoinDialog);
});

$$('[data-close-join]').forEach((button) => {
  button.addEventListener('click', closeJoinDialog);
});

if (joinDialog) {
  joinDialog.addEventListener('click', (event) => {
    if (event.target === joinDialog) closeJoinDialog();
  });
}

if (joinInput) {
  joinInput.addEventListener('input', () => {
    const formatted = formatCode(joinInput.value);
    if (joinInput.value !== formatted) joinInput.value = formatted;
    if (joinError) joinError.hidden = true;
  });
}

if (joinForm && joinInput) {
  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = normalizeCode(joinInput.value);
    if (code.length < 4 || code.length > 12) {
      if (joinError) {
        joinError.textContent = t('landing.codeFormat');
        joinError.hidden = false;
      }
      joinInput.focus();
      return;
    }
    navigateToRoom(code);
  });
}

// Keep the language choice when following an internal link.
document.addEventListener('click', (event) => {
  const link = event.target.closest?.('a[href^="/r/"]');
  if (!link) return;
  const lang = document.documentElement.dataset.lang;
  if (!lang) return;
  try {
    const url = new URL(link.href, window.location.origin);
    if (!url.searchParams.has('lang')) {
      url.searchParams.set('lang', lang);
      link.href = url.pathname + url.search + url.hash;
    }
  } catch {
    // Keep the original link if it cannot be parsed.
  }
});
