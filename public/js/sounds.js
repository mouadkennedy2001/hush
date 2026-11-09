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
  blip: [[1200, 0.08], [1000, 0.08]],
  hand: [[700, 0.1], [900, 0.12]],
  knock: [[180, 0.1], [180, 0.1], [180, 0.14]],
  camera: [[1000, 0.08], [1400, 0.1]],
  share: [[500, 0.1], [750, 0.1], [1000, 0.14]],
  reaction: [[800, 0.1], [1200, 0.12]],
  pop: [[600, 0.07], [900, 0.07], [600, 0.08]],
  welcome: [[523, 0.1], [659, 0.1], [784, 0.15]],
  goodbye: [[784, 0.12], [659, 0.12], [523, 0.18]],
  coin: [[880, 0.08], [1320, 0.18]],
  levelup: [[523, 0.1], [659, 0.1], [784, 0.1], [1046, 0.25]],
  warning: [[220, 0.15], [220, 0.2]],
  achievement: [[392, 0.1], [523, 0.1], [659, 0.1], [784, 0.2]],
  whoosh: [[300, 0.2], [500, 0.2], [400, 0.15]],
  chime: [[1046, 0.15], [1318, 0.3]],
  bubble: [[500, 0.08], [700, 0.08], [900, 0.12]],
  slide: [[400, 0.1], [600, 0.1], [800, 0.1]],
  dingdong: [[659, 0.12], [880, 0.12], [659, 0.2]],
  echo: [[300, 0.15], [240, 0.15], [180, 0.3]],
  // Sound Forge presence pack (wav first, these are only the fallback beeps)
  connect: [[523, 0.1], [784, 0.16]],
  disconnect: [[784, 0.1], [523, 0.16]],
  mute: [[660, 0.1], [440, 0.14]],
  unmute: [[440, 0.1], [660, 0.14]],
  deafen: [[440, 0.1], [330, 0.16]],
  undeafen: [[330, 0.1], [440, 0.16]],
  screenshare_start: [[500, 0.1], [750, 0.14]],
  screenshare_stop: [[750, 0.1], [500, 0.14]],
  incoming_call: [[660, 0.12], [880, 0.12], [660, 0.12], [880, 0.18]],
  call_end: [[880, 0.1], [660, 0.1], [440, 0.16]],
  notification: [[784, 0.12], [1046, 0.2]],
  notification_soft: [[880, 0.2]],
  ding: [[1568, 0.25]],
  info: [[1046, 0.15]],
  sparkle: [[1318, 0.08], [1568, 0.08], [2093, 0.16]],
  sonar: [[1046, 0.3]],
  send: [[500, 0.08], [1000, 0.12]],
  receive: [[1000, 0.08], [750, 0.12]],
  pin: [[1200, 0.08], [1568, 0.14]],
  critical: [[330, 0.12], [277, 0.12], [220, 0.16]],
  alarm: [[880, 0.1], [880, 0.1], [880, 0.14]],
  unlock: [[523, 0.08], [784, 0.14]],
  lock: [[784, 0.08], [523, 0.14]]
};

export const UI_SOUNDS = Object.keys(FALLBACK);

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

// Cache one <audio> per sound so repeated plays reuse the decoded buffer
// (new Audio() every time forced a network fetch + decode on each play).
const audioCache = new Map();
function cachedAudio(name) {
  let audio = audioCache.get(name);
  if (!audio) {
    audio = new Audio(`/sounds/${encodeURIComponent(name)}.wav`);
    audio.preload = 'auto';
    audioCache.set(name, audio);
  }
  return audio;
}

export function playSound(name, { force = false } = {}) {
  if (!enabled && !force) return;
  // Throttle identical sounds (max 1 per 250ms) to avoid stacking.
  const now = Date.now();
  if (now - (lastPlay[name] || 0) < 250) return;
  lastPlay[name] = now;
  try {
    const audio = cachedAudio(name);
    audio.volume = volume;
    try { audio.currentTime = 0; } catch { /* not seekable yet */ }
    audio.play().catch(() => playFallback(name));
  } catch {
    playFallback(name);
  }
}

export function playChime() { playSound('message'); }
