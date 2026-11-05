import { staticAr } from './i18n/static-ar.js';
import { ui } from './i18n/ui.js';

const LANG_KEY = 'hush:lang';
const SUPPORTED = new Set(['en', 'ar']);
const textOriginals = new WeakMap();
const attrOriginals = new WeakMap();

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

// Dynamic or user-authored areas are never auto-translated. Their text is
// rendered through t() by the page modules instead.
const SKIP_SELECTOR = [
  'script',
  'style',
  'noscript',
  'textarea',
  '.messages',
  '.tile-grid',
  '#people-list',
  '#typing',
  '.toast-region',
  '#landing-error',
  '#join-error',
  '#composer-hint',
  '#chat-empty',
  '#connection-label',
  '#stage-count',
  '#screen-label',
  '#unread-badge',
  '#people-count',
  '#search-summary',
  '#chat-search-count',
  '#sound-label',
  '#mic-label',
  '#camera-label',
  '#screen-label-btn',
  '[data-no-translate]'
].join(',');

let currentLanguage = 'en';
let initialized = false;
let toggleBound = false;

export function getLanguage() {
  return currentLanguage;
}

export function isRtl() {
  return currentLanguage === 'ar';
}

export function locale() {
  return currentLanguage === 'ar' ? 'ar' : 'en';
}

export function t(key, vars = {}) {
  const entry = ui[key];
  const index = currentLanguage === 'ar' ? 1 : 0;
  const template = entry?.[index] ?? entry?.[0] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

function detectLanguage() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (SUPPORTED.has(fromUrl)) {
      localStorage.setItem(LANG_KEY, fromUrl);
      return fromUrl;
    }
    const stored = localStorage.getItem(LANG_KEY);
    if (SUPPORTED.has(stored)) return stored;
  } catch {
    // Storage can be blocked in private modes; fall through.
  }

  const browser = String(navigator.language || 'en').toLowerCase();
  return browser.startsWith('ar') ? 'ar' : 'en';
}

export function setLanguage(next) {
  if (!SUPPORTED.has(next)) return currentLanguage;
  if (next === currentLanguage) {
    applyTranslations();
    return currentLanguage;
  }

  currentLanguage = next;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    // Still switch for this page even when storage is unavailable.
  }
  applyTranslations();
  return currentLanguage;
}

export function initI18n() {
  if (initialized) return currentLanguage;
  initialized = true;
  currentLanguage = detectLanguage();
  bindLanguageToggle();
  applyTranslations();
  return currentLanguage;
}

function bindLanguageToggle() {
  if (toggleBound) return;
  toggleBound = true;
  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-lang-toggle]');
    if (!button) return;
    event.preventDefault();
    setLanguage(currentLanguage === 'ar' ? 'en' : 'ar');
  });
}

function walkTextNodes(root, visit) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    visit(node);
    node = walker.nextNode();
  }
}

function translateText(root) {
  walkTextNodes(root, (node) => {
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP_SELECTOR)) return;

    const raw = node.nodeValue ?? '';
    const key = raw.trim();
    if (!key) return;

    const translated =
      staticAr[key] ?? staticAr[key.replace(/\s+/g, ' ')] ?? null;
    if (!translated) return;

    if (!textOriginals.has(node)) textOriginals.set(node, raw);
    const leading = raw.match(/^\s*/)?.[0] ?? '';
    const trailing = raw.match(/\s*$/)?.[0] ?? '';
    node.nodeValue = `${leading}${translated}${trailing}`;
  });
}

function restoreText(root) {
  walkTextNodes(root, (node) => {
    if (!textOriginals.has(node)) return;
    node.nodeValue = textOriginals.get(node);
  });
}

function translateAttributes(root) {
  for (const element of root.querySelectorAll('*')) {
    if (element.closest(SKIP_SELECTOR)) continue;
    for (const attr of ATTRS) {
      if (!element.hasAttribute(attr)) continue;
      const raw = element.getAttribute(attr);
      const key = raw.trim();
      if (!key) continue;
      const translated = staticAr[key];
      if (!translated) continue;

      let store = attrOriginals.get(element);
      if (!store) {
        store = new Map();
        attrOriginals.set(element, store);
      }
      if (!store.has(attr)) store.set(attr, raw);
      element.setAttribute(attr, translated);
    }
  }
}

function restoreAttributes(root) {
  for (const element of root.querySelectorAll('*')) {
    const store = attrOriginals.get(element);
    if (!store) continue;
    for (const [attr, value] of store) element.setAttribute(attr, value);
  }
}

function updateLanguageToggles() {
  const other = currentLanguage === 'ar' ? 'English' : 'العربية';
  for (const button of document.querySelectorAll('[data-lang-toggle]')) {
    button.setAttribute('title', t('lang.switch'));
    button.setAttribute('aria-label', t('lang.switch'));
    const label = button.querySelector('[data-lang-label]');
    if (label) label.textContent = other;
  }
}

export function applyTranslations(root = document.body) {
  document.documentElement.lang = currentLanguage;
  document.documentElement.dir = currentLanguage === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.dataset.lang = currentLanguage;

  if (!root) return;

  if (currentLanguage === 'ar') {
    translateText(root);
    translateAttributes(root);
  } else {
    restoreText(root);
    restoreAttributes(root);
  }

  updateLanguageToggles();
  document.dispatchEvent(
    new CustomEvent('hush:languagechange', {
      detail: { lang: currentLanguage }
    })
  );
}

export function onLanguageChange(handler) {
  document.addEventListener('hush:languagechange', (event) => {
    handler(event.detail.lang);
  });
}
