// Sound effects: try /sounds/<name>.wav first, fall back to WebAudio beeps.
// Keeps the old chime behaviour working even if files are missing.
const SOUND_KEY = 'hush:sounds';
const VOLUME_KEY = 'hush:sound-volume';

const FALLBACK = {
  message: [[660, 0.12], [880, 0.14]],
  mention: [[523, 0.1], [784, 0.1], [1046, 0.16]],
  join: [[440, 0.12], [660, 0.14]],
  leave: [[660, 0.12], [440, 0.14]],
  error: [[220, 0.15], [180, 0.18]],
  kick: [[300, 0.15], [200, 0.18]],
  ban: [[200, 0.15], [140, 0.15], [100, 0.2]],
  success: [[523, 0.12], [659, 0.12], [784, 0.18]],
  click: [[900, 0.06]],
  blip: [[1200, 0.08], [1000, 0.08]]
};

let enabled = true;
let volume = 0.7;
let ctx = null;
let lastPlay = {};

try {
  enabled = localStorage.getItem(SOUND_KEY) !== 'off';
  volume = Number(localStorage.getItem(VOLUME_KEY)) || 0.7;
} catch {}

export function getSoundsEnabled() { return enabled; }
export function setSoundsEnabled(value) {
  enabled = Boolean(value);
  try { localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off'); } catch {}
}
export function getSoundVolume() { return volume; }
export function setSoundVolume(value) {
  volume = Math.min(1, Math.max(0, Number(value) || 0));
  try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch {}
}

function audioCtx() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try { ctx = new Ctx(); } catch { return null; }
  return ctx;
}

function playOsc(freq, dur, when = 0) {
  const c = audioCtx();
  if (!c) return;
  c.resume?.().catch(() => {});
  const now = c.currentTime + when;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.05 * volume, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

function playFallback(name) {
  const seq = FALLBACK[name] || FALLBACK.message;
  let offset = 0;
  for (const [freq, dur] of seq) {
    playOsc(freq, dur, offset);
    offset += dur * 0.9;
  }
}

export function playSound(name, { force = false } = {}) {
  if (!enabled && !force) return;
  // Throttle identical sounds (max 1 per 250ms) to avoid stacking.
  const now = Date.now();
  if (now - (lastPlay[name] || 0) < 250) return;
  lastPlay[name] = now;
  try {
    const audio = new Audio(`/sounds/${encodeURIComponent(name)}.wav`);
    audio.volume = volume;
    audio.play().catch(() => playFallback(name));
  } catch {
    playFallback(name);
  }
}

export function playChime() { playSound('message'); }
