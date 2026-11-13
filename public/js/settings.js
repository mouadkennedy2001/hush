import { t } from './i18n.js';

// Display / comfort settings: text size, density, motion, speaker volume,
// and mention notifications. Persisted as one JSON blob in localStorage.
const SETTINGS_KEY = 'hush:settings';

const DEFAULTS = {
  fontsize: 'normal',
  density: 'comfortable',
  motion: 'on',
  volume: 1,
  notifications: false,
  haptics: 'on',
  wakeLock: 'on'
};

let settings = { ...DEFAULTS };
let initialized = false;

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') settings = { ...DEFAULTS, ...parsed };
    }
  } catch {
    // Keep defaults when storage is unavailable or corrupted.
  }
  return { ...settings };
}

export function getSettings() {
  return { ...settings };
}

export function applySettings() {
  const root = document.documentElement;
  root.dataset.fontsize = settings.fontsize;
  root.dataset.density = settings.density;
  root.dataset.motion = settings.motion;
  applyVolume();
  syncSettingsUi();
}

export function updateSettings(patch) {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // The settings still apply for this page.
  }
  applySettings();
  // Room code listens for this to start/stop the wake lock immediately.
  try {
    window.dispatchEvent(new CustomEvent('hush:settings', { detail: { ...settings } }));
  } catch {
    // CustomEvent is unavailable only in exotic embeddings.
  }
  return { ...settings };
}

// The media mesh owns remote-audio gains (per-peer volume, master volume,
// AND deafen). This module must never touch <audio> elements directly:
// writing volume/muted here used to un-silence deafened peers in rooms
// (settings.js is room-only, which is why deafen "worked in servers but
// not rooms"). Rooms register a sink that forwards the master volume.
let volumeSink = null;
export function registerVolumeSink(fn) {
  volumeSink = typeof fn === 'function' ? fn : null;
}

export function applyVolume() {
  const volume = Math.min(1, Math.max(0, Number(settings.volume) || 0));
  try { volumeSink?.(volume); } catch { /* mesh not ready yet */ }
  const output = document.querySelector('[data-volume-value]');
  const label = `${Math.round(volume * 100)}%`;
  // Only write when changed: writing unconditionally inside the observed
  // subtree would retrigger the MutationObserver forever and freeze the page.
  if (output && output.textContent !== label) output.textContent = label;
}

function syncSettingsUi() {
  for (const group of document.querySelectorAll('[data-setting-group]')) {
    const key = group.dataset.settingGroup;
    for (const button of group.querySelectorAll('button[data-setting-value]')) {
      button.setAttribute('aria-pressed', String(button.dataset.settingValue === String(settings[key])));
    }
  }
  const volume = document.querySelector('[data-volume-input]');
  if (volume) volume.value = String(Math.round((settings.volume || 0) * 100));
  const notify = document.querySelector('[data-notifications-toggle]');
  if (notify) {
    notify.setAttribute('aria-pressed', String(Boolean(settings.notifications)));
    const label = notify.querySelector('[data-notifications-label]');
    const nextLabel = t(settings.notifications ? 'settings.notificationsOn' : 'settings.notificationsOff');
    if (label && label.textContent !== nextLabel) label.textContent = nextLabel;
  }
  for (const node of document.querySelectorAll('[data-setting-label]')) {
    const key = node.dataset.settingLabel;
    if (key && settings[key] !== undefined) node.textContent = String(settings[key]);
  }
  // Toggle rows added by the mobile layer (haptics, wake lock): the visible
  // title is translated through the runtime dictionary, and the segmented
  // control's accessible name follows it.
  for (const node of document.querySelectorAll('[data-setting-key]')) {
    const key = node.dataset.settingKey;
    if (!key || !(key in settings)) continue;
    const label = t(`settings.${key}`);
    if (node.tagName === 'SPAN') {
      if (node.textContent !== label) node.textContent = label;
    } else if (node.hasAttribute('aria-label') && node.getAttribute('aria-label').trim()) {
      node.setAttribute('aria-label', label);
    }
  }
}

function bindSettingsUi() {
  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-setting-value]');
    if (!button) return;
    const group = button.closest('[data-setting-group]');
    const key = group?.dataset.settingGroup;
    if (!key) return;
    updateSettings({ [key]: button.dataset.settingValue });
  });

  document.addEventListener('input', (event) => {
    const volume = event.target?.closest?.('[data-volume-input]');
    if (!volume) return;
    updateSettings({ volume: Number(volume.value) / 100 });
  });

  document.addEventListener('click', async (event) => {
    const toggle = event.target?.closest?.('[data-notifications-toggle]');
    if (!toggle) return;
    if (!settings.notifications) {
      try {
        if ('Notification' in window && Notification.permission === 'default') {
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') return;
        }
      } catch {
        return;
      }
    }
    updateSettings({ notifications: !settings.notifications });
  });
}

export function initSettings() {
  loadSettings();
  if (initialized) return { ...settings };
  initialized = true;
  bindSettingsUi();
  applySettings();
  // Remote audio elements are created lazily by the media mesh. Only react
  // when a new <audio> actually arrives — never to our own text writes.
  const container = document.querySelector('#remote-audio');
  if (container) {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeName === 'AUDIO' || node.querySelector?.('audio')) {
            applyVolume();
            return;
          }
        }
      }
    });
    observer.observe(container, { childList: true, subtree: true });
  }
  return { ...settings };
}
