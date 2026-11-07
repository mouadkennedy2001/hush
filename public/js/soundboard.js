// Soundboard — built-in sounds are synthesized (WebAudio, no files), and
// each one shows a custom Hush emoji from public/emoji/ (not a Unicode
// emoji). Custom room sounds are uploaded audio files played from their
// /uploads/<room>/board/ URL; they are deleted when the room empties.
// Playing any sound relays it to the room via Socket.IO `soundboard:play`
// (server validates built-in ids + the room's custom-sound list).

import { emojiUrl, isCustomEmoji } from './emoji.js';

export { CUSTOM_EMOJIS, isCustomEmoji, emojiUrl } from './emoji.js';

export const SOUNDBOARD_SOUNDS = [
  { id: 'airhorn', emojiId: 'airhorn' },
  { id: 'rimshot', emojiId: 'rimshot' },
  { id: 'applause', emojiId: 'applause' },
  { id: 'trombone', emojiId: 'trombone' },
  { id: 'boing', emojiId: 'boing' },
  { id: 'ding', emojiId: 'ding' },
  { id: 'pop', emojiId: 'pop' },
  { id: 'fart', emojiId: 'fart' },
  { id: 'cat', emojiId: 'cat' },
  { id: 'wow', emojiId: 'wow' },
  { id: 'crickets', emojiId: 'crickets' },
  { id: 'tada', emojiId: 'tada' }
];

const VOLUME_KEY = 'hush:soundboard-volume';
const IDS = new Set(SOUNDBOARD_SOUNDS.map((s) => s.id));

let volume = 0.7;
try {
  const saved = Number(localStorage.getItem(VOLUME_KEY));
  if (Number.isFinite(saved)) volume = Math.min(1, Math.max(0, saved));
} catch { /* ignore */ }

export function isSoundboardId(id) { return IDS.has(id); }
export function getSoundboardVolume() { return volume; }
export function setSoundboardVolume(value) {
  volume = Math.min(1, Math.max(0, Number(value) || 0));
  try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch { /* ignore */ }
}

let ctx = null;
function audioCtx() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try { ctx = new Ctx({ latencyHint: 'interactive' }); } catch { return null; }
  return ctx;
}

function tone({ freq = 440, end = null, dur = 0.2, type = 'sine', when = 0, vol = 0.3, vibrato = 0 } = {}) {
  const c = audioCtx();
  if (!c) return;
  c.resume?.().catch(() => {});
  const now = c.currentTime + when;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (end) osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), now + dur);
  if (vibrato) {
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lfo.frequency.value = vibrato;
    lfoGain.gain.value = freq * 0.06;
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start(now); lfo.stop(now + dur + 0.05);
  }
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, vol * volume), now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(now); osc.stop(now + dur + 0.05);
}

function noise({ dur = 0.2, when = 0, vol = 0.3, freq = 1200, type = 'bandpass', q = 0.8 } = {}) {
  const c = audioCtx();
  if (!c) return;
  c.resume?.().catch(() => {});
  const now = c.currentTime + when;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buffer = c.createBuffer(1, len, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  const source = c.createBufferSource();
  source.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
  const gain = c.createGain();
  gain.gain.setValueAtTime(Math.max(0.001, vol * volume), now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  source.connect(filter).connect(gain).connect(c.destination);
  source.start(now); source.stop(now + dur + 0.02);
}

const SYNTH = {
  airhorn() {
    for (const f of [233, 466, 622]) tone({ freq: f, dur: 0.55, type: 'sawtooth', vol: 0.14, vibrato: 6 });
    tone({ freq: 233, dur: 0.55, type: 'square', vol: 0.05 });
  },
  rimshot() {
    noise({ dur: 0.08, vol: 0.35, freq: 2000, type: 'highpass' });
    tone({ freq: 180, end: 90, dur: 0.22, type: 'triangle', vol: 0.4, when: 0.02 });
    noise({ dur: 0.12, vol: 0.25, freq: 900, when: 0.06 });
  },
  applause() {
    for (let i = 0; i < 14; i += 1) {
      noise({ dur: 0.05, when: Math.random() * 0.9, vol: 0.12 + Math.random() * 0.14, freq: 900 + Math.random() * 1400, q: 1.4 });
    }
  },
  trombone() {
    const notes = [233, 220, 208, 196];
    notes.forEach((f, i) => tone({ freq: f, dur: 0.34, type: 'sawtooth', vol: 0.16, when: i * 0.3, vibrato: 5 }));
  },
  boing() {
    tone({ freq: 320, end: 70, dur: 0.45, type: 'sine', vol: 0.4, vibrato: 9 });
    tone({ freq: 160, end: 50, dur: 0.45, type: 'triangle', vol: 0.2, vibrato: 9 });
  },
  ding() {
    tone({ freq: 1568, dur: 0.7, type: 'triangle', vol: 0.32 });
    tone({ freq: 2093, dur: 0.5, type: 'sine', vol: 0.15, when: 0.02 });
    tone({ freq: 2637, dur: 0.35, type: 'sine', vol: 0.08, when: 0.04 });
  },
  pop() {
    tone({ freq: 500, end: 140, dur: 0.11, type: 'sine', vol: 0.45 });
    noise({ dur: 0.03, vol: 0.2, freq: 2500, type: 'highpass' });
  },
  fart() {
    tone({ freq: 110, end: 55, dur: 0.5, type: 'sawtooth', vol: 0.28, vibrato: 28 });
    noise({ dur: 0.5, vol: 0.12, freq: 300, type: 'lowpass', q: 0.5 });
  },
  cat() {
    tone({ freq: 550, end: 950, dur: 0.18, type: 'sawtooth', vol: 0.18, when: 0 });
    tone({ freq: 950, end: 480, dur: 0.3, type: 'sawtooth', vol: 0.18, when: 0.16, vibrato: 7 });
    tone({ freq: 400, end: 300, dur: 0.15, type: 'triangle', vol: 0.12, when: 0.44 });
  },
  wow() {
    tone({ freq: 420, end: 180, dur: 0.65, type: 'sine', vol: 0.3, vibrato: 4 });
    tone({ freq: 210, end: 90, dur: 0.65, type: 'triangle', vol: 0.15, vibrato: 4 });
  },
  crickets() {
    for (let chirp = 0; chirp < 3; chirp += 1) {
      for (let i = 0; i < 5; i += 1) {
        tone({ freq: 4200, dur: 0.03, type: 'sine', vol: 0.1, when: chirp * 0.35 + i * 0.055 });
      }
    }
  },
  tada() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => tone({ freq: f, dur: 0.24, type: 'triangle', vol: 0.26, when: i * 0.09 }));
    tone({ freq: 1318, dur: 0.5, type: 'triangle', vol: 0.22, when: 0.36 });
    noise({ dur: 0.25, vol: 0.08, freq: 4000, type: 'highpass', when: 0.36 });
  }
};

export function playSoundboard(id) {
  if (!IDS.has(id)) return false;
  const synth = SYNTH[id];
  if (!synth) return false;
  try { synth(); return true; } catch { return false; }
}

// Custom (uploaded) room sounds: play the audio file, reusing one
// <audio> per URL so repeats don't re-fetch.
const customAudioCache = new Map();
export function playCustomSound(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/') || url.includes('..')) return false;
  try {
    let audio = customAudioCache.get(url);
    if (!audio) { audio = new Audio(url); audio.preload = 'auto'; customAudioCache.set(url, audio); }
    audio.volume = volume;
    try { audio.currentTime = 0; } catch { /* ignore */ }
    audio.play().catch(() => {});
    return true;
  } catch { return false; }
}

export function soundboardEmojiId(id) {
  return SOUNDBOARD_SOUNDS.find((s) => s.id === id)?.emojiId ?? 'star';
}
