import { t, onLanguageChange } from './i18n.js';

// Live latency ("ping") meter — v2 algorithms:
// - monotonic clock (performance.now) so wall-clock changes don't fake ping
// - median filter (kills single-sample spikes)
// - EWMA smoothing (alpha 0.3) for a steady displayed value
// - outlier rejection: samples > 3x median are dropped
// - adaptive interval: poor/offline polls faster, good polls slower
// Prefers Socket.IO round-trip; falls back to GET /api/ping.

const BASE_INTERVAL_MS = 4000;
const TIMEOUT_MS = 3000;
const MAX_SAMPLES = 20;
const EWMA_ALPHA = 0.3;

let started = false;
let getSocket = () => null;
let timer = null;
let lastSample = null;
let ewma = null;
let samples = [];
let seq = 0;

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

function pushSample(raw) {
  const med = median(samples.slice(-8));
  // Outlier rejection: a spike 3x the recent median is almost certainly noise.
  if (med != null && raw > med * 3 && samples.length >= 4) return false;
  samples.push(raw);
  if (samples.length > MAX_SAMPLES) samples.shift();
  ewma = ewma == null ? raw : Math.round(EWMA_ALPHA * raw + (1 - EWMA_ALPHA) * ewma);
  return true;
}

async function measureViaSocket(socket) {
  const sentMono = nowMono();
  const mySeq = ++seq;
  const response = await new Promise((resolve, reject) => {
    const timerId = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
    try {
      socket.emit('ping:request', { t: Date.now(), seq: mySeq }, (ack) => {
        clearTimeout(timerId);
        resolve(ack);
      });
    } catch (error) {
      clearTimeout(timerId);
      reject(error);
    }
  });
  if (!response?.ok || response.seq !== mySeq) throw new Error('stale-pong');
  // RTT from monotonic clock; server also returns serverTime for offset display.
  return Math.max(0, Math.round(nowMono() - sentMono));
}

async function measureViaHttp() {
  const sentMono = nowMono();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timerId = setTimeout(() => controller?.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`/api/ping?t=${Date.now()}`, {
      cache: 'no-store',
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
  let ms = null;
  try {
    const socket = getSocket?.();
    if (socket?.connected) ms = await measureViaSocket(socket);
    else ms = await measureViaHttp();
  } catch { ms = null; }
  lastSample = ms;
  if (ms != null) pushSample(ms);
  render();
  scheduleNext();
}

function nextInterval() {
  const q = qualityFor(lastSample);
  if (q === 'good') return 5000;
  if (q === 'fair') return 3500;
  if (q === 'poor') return 2000;
  return 1500; // offline: retry soon
}

function scheduleNext() {
  if (!started) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void measure(), nextInterval());
}

function drawChart() {
  const canvas = document.querySelector('[data-ping-chart]');
  if (!canvas) return;
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
  const displayed = ewma != null ? ewma : lastSample;
  const quality = qualityFor(lastSample);
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

export function refreshPing() { void measure(); }
export function getPingSamples() { return [...samples]; }
export function getPingModel() { return { last: lastSample, ewma, median: median(samples), avg: average(), jitter: jitter(), quality: qualityFor(lastSample) }; }

export function startPing({ socketGetter = () => null, intervalMs } = {}) {
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
