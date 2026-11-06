import { t } from './i18n.js';

const THEME_KEY = 'hush:theme';

let currentMode = 'light'; // 'light' | 'dark' | 'auto'
let currentTheme = 'light'; // resolved: 'light' | 'dark'
let initialized = false;
let toggleBound = false;

const THEME_COLORS = { light: '#9dbbf8', dark: '#10131b' };

export function getTheme() {
  return currentTheme;
}

export function getThemeMode() {
  return currentMode;
}

function systemTheme() {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function resolveMode(mode) {
  return mode === 'auto' ? systemTheme() : mode;
}

function detectMode() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('theme');
    if (fromUrl === 'dark' || fromUrl === 'light' || fromUrl === 'auto') {
      localStorage.setItem(THEME_KEY, fromUrl);
      return fromUrl;
    }
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'auto') return stored;
  } catch {
    // Storage can be blocked; fall through to the system preference.
  }
  return 'auto';
}

function applyResolved() {
  currentTheme = resolveMode(currentMode);
  document.documentElement.dataset.theme = currentTheme;
  document.documentElement.dataset.thememode = currentMode;
  document.documentElement.style.colorScheme = currentTheme;
}

export function setThemeMode(next) {
  if (next !== 'dark' && next !== 'light' && next !== 'auto') return currentMode;
  currentMode = next;
  applyResolved();
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Still switch for this page even when storage is unavailable.
  }
  updateThemeToggles();
  updateThemeColorMeta();
  document.dispatchEvent(
    new CustomEvent('hush:themechange', { detail: { theme: currentTheme, mode: next } })
  );
  return currentMode;
}

// Backwards-compatible: setTheme('dark'|'light') pins a mode.
export function setTheme(next) {
  if (next !== 'dark' && next !== 'light') return currentTheme;
  setThemeMode(next);
  return currentTheme;
}

export function toggleTheme() {
  // Cycle: light → dark → auto → light…
  const next = currentMode === 'light' ? 'dark' : currentMode === 'dark' ? 'auto' : 'light';
  setThemeMode(next);
  return currentTheme;
}

function updateThemeColorMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[currentTheme]);
}

function updateThemeToggles() {
  for (const button of document.querySelectorAll('[data-theme-toggle]')) {
    const label =
      currentMode === 'auto' ? t('theme.auto') : currentMode === 'dark' ? t('theme.dark') : t('theme.light');
    const action =
      currentMode === 'light' ? t('theme.toDark') : currentMode === 'dark' ? t('theme.toAuto') : t('theme.toLight');
    button.setAttribute('title', action);
    button.setAttribute('aria-label', action);
    button.setAttribute('aria-pressed', String(currentTheme === 'dark'));
    const text = button.querySelector('[data-theme-label]');
    if (text && text.textContent !== label) text.textContent = label;
  }
}

function bindThemeToggle() {
  if (toggleBound) return;
  toggleBound = true;
  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-theme-toggle]');
    if (!button) return;
    event.preventDefault();
    toggleTheme();
  });
  // In auto mode, follow the OS when it changes.
  try {
    window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener('change', () => {
      if (currentMode !== 'auto') return;
      applyResolved();
      updateThemeToggles();
      updateThemeColorMeta();
      document.dispatchEvent(
        new CustomEvent('hush:themechange', { detail: { theme: currentTheme, mode: 'auto' } })
      );
    });
  } catch {
    // Older browsers: auto simply resolves once at load.
  }
}

export function initTheme() {
  if (initialized) return currentTheme;
  initialized = true;
  currentMode = detectMode();
  applyResolved();
  bindThemeToggle();
  updateThemeToggles();
  updateThemeColorMeta();
  return currentTheme;
}

export function onThemeChange(handler) {
  document.addEventListener('hush:themechange', (event) => {
    handler(event.detail.theme);
  });
}
