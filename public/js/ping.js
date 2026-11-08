import { t, onLanguageChange } from './i18n.js';
import { createPingOp, PING_OP_VERSION } from './ping-op/ping-op.js';

// Live latency ("ping") meter — powered by PING OP v1.0 (see PING OP/src/client.js):
// - 2 parallel probes per round, take the MIN (best) RTT — kills
//   polling/queue jitter without flooding the server (v3 used 3, which
//   added contention and raised the very ping it was measuring)
// - displayed value = min of last 4 rounds, updated every ~3s when good
//   (v3 waited 5s, so improvements showed late)
// - monotonic clock (performance.now), only 1 warmup round discarded
// - paused while the tab is hidden (no wasted probes / battery)
// - chart only redraws when the People panel is actually visible
// Prefers Socket.IO round-trip; falls back to GET /api/ping.
// NOTE: ping measures real network RTT — it cannot go below physics.
// The server-side wins (TCP_NODELAY, 5s heartbeat) are in src/app.js.
// Statistics (min/avg/jitter/loss/score) come from the PING OP core engine.

const TIMEOUT_MS = 1500;
const MAX_SAMPLES = 24;
const PROBES = 2;

let started = false;
let getSocket = () => null;
let timer = null;
let lastSample = null;
let displayed = null;
let samples = [];
let rounds = []; // min per round
let seq = 0;
let warmup = 0;
const pingOp = createPingOp({ maxSamples: 60 });
export const PING_OP_UI_VERSION = PING_OP_VERSION;

function nowMono() { return performance.now(); }

function qualityFor(ms) {
  if (ms == null) return 'offline';
  if (ms < 80) return 'good';
  if (ms < 180) return 'fair';
  return 'poor';
}

function qualityLabel(quality) {
  switch (quality) {
    case 'good': return t('ping.good');
    case 'fair': return t('ping.fair');
    case 'poor': return t('ping.poor');
    default: return t('ping.offline');
  }
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function average() {
  if (!samples.length) return null;
  return Math.round(samples.reduce((sum, v) => sum + v, 0) / samples.length);
}

function jitter() {
  if (samples.length < 2) return null;
  const deltas = [];
  for (let i = 1; i < samples.length; i += 1) deltas.push(Math.abs(samples[i] - samples[i - 1]));
  return Math.round(deltas.reduce((sum, v) => sum + v, 0) / deltas.length);
}

function probeOnce(socket, mySeq) {
  return new Promise((resolve, reject) => {
    const sentMono = nowMono();
    const timerId = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
    try {
      socket.emit('ping:request', { t: Date.now(), seq: mySeq }, (ack) => {
        clearTimeout(timerId);
        if (!ack?.ok || ack.seq !== mySeq) return reject(new Error('stale-pong'));
        resolve(Math.max(0, Math.round(nowMono() - sentMono)));
      });
    } catch (error) {
      clearTimeout(timerId);
      reject(error);
    }
  });
}

async function measureViaSocket(socket) {
  const probes = [];
  for (let i = 0; i < PROBES; i += 1) probes.push(probeOnce(socket, ++seq).catch(() => null));
  const results = (await Promise.all(probes)).filter((v) => v != null);
  if (!results.length) throw new Error('all-probes-failed');
  return Math.min(...results); // best of 2
}

async function measureViaHttp() {
  const sentMono = nowMono();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timerId = setTimeout(() => controller?.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`/api/ping?t=${Date.now()}`, {
      cache: 'no-store',
      keepalive: true,
      signal: controller?.signal
    });
    if (!response.ok) throw new Error('ping-failed');
    await response.json().catch(() => ({}));
    return Math.max(0, Math.round(nowMono() - sentMono));
  } finally {
    clearTimeout(timerId);
  }
}

async function measure() {
  if (document.hidden) { scheduleNext(); return; }
  let ms = null;
  try {
    const socket = getSocket?.();
    if (socket?.connected) ms = await measureViaSocket(socket);
    else ms = await measureViaHttp();
  } catch { ms = null; }
  lastSample = ms;
  // Feed the PING OP core engine so server/client share one stats model.
  pingOp.sample(ms);
  // During heavy media (screen share) the signaling socket queues behind
  // media packets — the HTTP probe is not suppressed, but don't let one
  // burst round poison the displayed value.
  if (ms != null) {
    if (warmup < 1) { warmup += 1; samples.push(ms); if (displayed == null) displayed = ms; }
    else {
      samples.push(ms);
      if (samples.length > MAX_SAMPLES) samples.shift();
      rounds.push(ms);
      if (rounds.length > 4) rounds.shift();
      // Displayed = recent best (min of last 4 rounds): drops show
      // immediately, a single spike cannot poison the badge.
      displayed = Math.min(...rounds);
    }
  }
  render();
  scheduleNext();
}

function nextInterval() {
  const q = qualityFor(displayed);
  if (q === 'good') return 3000;
  if (q === 'fair') return 2000;
  if (q === 'poor') return 1200;
  return 900;
}

function scheduleNext() {
  if (!started) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void measure(), nextInterval());
}

function drawChart() {
  const canvas = document.querySelector('[data-ping-chart]');
  if (!canvas) return;
  // Skip the canvas work when the panel holding it is hidden.
  if (canvas.offsetParent === null && !canvas.closest('.panel-people')) return;
  const panel = canvas.closest('.panel-people');
  if (panel && panel.hidden) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = canvas.clientWidth || 300;
  const height = canvas.clientHeight || 56;
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const dark = document.documentElement.dataset.theme === 'dark';
  const grid = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const line = dark ? '#6f9bff' : '#2c6bed';
  const max = Math.max(200, ...samples);
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i += 1) {
    const y = (height / 4) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  if (samples.length < 2) return;
  const stepX = width / (MAX_SAMPLES - 1);
  const startX = width - stepX * (samples.length - 1);
  ctx.beginPath();
  samples.forEach((value, index) => {
    const x = startX + stepX * index;
    const y = height - 4 - (value / max) * (height - 10);
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.stroke();
  const lastIndex = samples.length - 1;
  const lx = startX + stepX * lastIndex;
  const ly = height - 4 - (samples[lastIndex] / max) * (height - 10);
  ctx.beginPath();
  ctx.arc(lx, ly, 2.6, 0, Math.PI * 2);
  ctx.fillStyle = line;
  ctx.fill();
}

function render() {
  const quality = qualityFor(displayed);
  const avg = average();
  const med = median(samples);
  const jit = jitter();
  for (const badge of document.querySelectorAll('[data-ping-badge]')) {
    badge.dataset.quality = quality;
    badge.title = `${t('ping.label')}: ${qualityLabel(quality)}`;
    badge.setAttribute('aria-label', `${t('ping.label')}: ${qualityLabel(quality)}`);
  }
  for (const node of document.querySelectorAll('[data-ping-value]')) {
    node.textContent = displayed == null ? '-- ms' : `${displayed} ms`;
  }
  for (const node of document.querySelectorAll('[data-ping-quality]')) {
    node.textContent = qualityLabel(quality);
  }
  for (const node of document.querySelectorAll('[data-ping-avg]')) {
    node.textContent = avg == null ? '--' : `${avg} ms`;
  }
  for (const node of document.querySelectorAll('[data-ping-median]')) {
    node.textContent = med == null ? '--' : `${med} ms`;
  }
  for (const node of document.querySelectorAll('[data-ping-jitter]')) {
    node.textContent = jit == null ? '--' : `${jit} ms`;
  }
  drawChart();
}

export function refreshPing() { warmup = 0; pingOp.reset(); if (timer) clearTimeout(timer); void measure(); }
export function getPingSamples() { return [...samples]; }
export function getPingOpStats() { return pingOp.getStats(); }
export function getPingModel() {
  const op = pingOp.getStats();
  return { last: lastSample, displayed, median: median(samples), avg: average(), jitter: jitter(), quality: qualityFor(displayed), score: op.score, version: PING_OP_VERSION };
}

export function startPing({ socketGetter = () => null } = {}) {
  getSocket = socketGetter;
  if (started) return;
  started = true;
  void measure();
  onLanguageChange(render);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void measure();
  });
}

export function stopPing() {
  if (timer) clearTimeout(timer);
  timer = null;
  started = false;
}
