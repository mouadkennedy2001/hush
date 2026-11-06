import { initI18n, onLanguageChange, t } from './i18n.js';
import { initTheme } from './theme.js';
import { startPing } from './ping.js';

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
