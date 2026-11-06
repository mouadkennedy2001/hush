import { t, onLanguageChange } from './i18n.js';

// Live latency ("ping") meter.
// Prefers a Socket.IO round-trip when a socket is provided (room page);
// falls back to GET /api/ping so the landing page can show it too.
// Samples feed a small ring buffer for average + jitter.

const INTERVAL_MS = 4000;
const TIMEOUT_MS = 3000;
const MAX_SAMPLES = 12;

let started = false;
let getSocket = () => null;
let timer = null;
let lastSample = null;
let samples = [];

function qualityFor(ms) {
  if (ms == null) return 'offline';
  if (ms < 100) return 'good';
  if (ms < 200) return 'fair';
  return 'poor';
}

function qualityLabel(quality) {
  switch (quality) {
    case 'good':
      return t('ping.good');
    case 'fair':
      return t('ping.fair');
    case 'poor':
      return t('ping.poor');
    default:
      return t('ping.offline');
  }
}

function average() {
  if (!samples.length) return null;
  return Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length);
}

function jitter() {
  if (samples.length < 2) return null;
  const deltas = [];
  for (let i = 1; i < samples.length; i += 1) {
    deltas.push(Math.abs(samples[i] - samples[i - 1]));
  }
  return Math.round(deltas.reduce((sum, value) => sum + value, 0) / deltas.length);
}

async function measureViaSocket(socket) {
  const sentAt = Date.now();
  const response = await new Promise((resolve, reject) => {
    const timerId = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
    try {
      socket.emit('ping:request', { t: sentAt }, (ack) => {
        clearTimeout(timerId);
        resolve(ack);
      });
    } catch (error) {
      clearTimeout(timerId);
      reject(error);
    }
  });
  if (!response?.ok || typeof response.t !== 'number') throw new Error('bad-pong');
  return Math.max(0, Date.now() - response.t);
}

async function measureViaHttp() {
  const sentAt = Date.now();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timerId = setTimeout(() => controller?.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`/api/ping?t=${sentAt}`, {
      cache: 'no-store',
      signal: controller?.signal
    });
    if (!response.ok) throw new Error('ping-failed');
    await response.json().catch(() => ({}));
    return Math.max(0, Date.now() - sentAt);
  } finally {
    clearTimeout(timerId);
  }
}

async function measure() {
  let ms = null;
  try {
    const socket = getSocket?.();
    if (socket?.connected) {
      ms = await measureViaSocket(socket);
    } else {
      ms = await measureViaHttp();
    }
  } catch {
    ms = null;
  }
  lastSample = ms;
  if (ms != null) {
    samples.push(ms);
    if (samples.length > MAX_SAMPLES) samples.shift();
  }
  render();
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
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (samples.length < 2) return;
  const stepX = width / (MAX_SAMPLES - 1);
  const startX = width - stepX * (samples.length - 1);
  ctx.beginPath();
  samples.forEach((value, index) => {
    const x = startX + stepX * index;
    const y = height - 4 - (value / max) * (height - 10);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
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
  const quality = qualityFor(lastSample);
  const avg = average();
  const jit = jitter();

  for (const badge of document.querySelectorAll('[data-ping-badge]')) {
    badge.dataset.quality = quality;
    badge.title = `${t('ping.label')}: ${qualityLabel(quality)}`;
    badge.setAttribute('aria-label', `${t('ping.label')}: ${qualityLabel(quality)}`);
  }

  for (const node of document.querySelectorAll('[data-ping-value]')) {
    node.textContent = lastSample == null ? '-- ms' : `${lastSample} ms`;
  }

  for (const node of document.querySelectorAll('[data-ping-quality]')) {
    node.textContent = qualityLabel(quality);
  }

  for (const node of document.querySelectorAll('[data-ping-avg]')) {
    node.textContent = avg == null ? '--' : `${avg} ms`;
  }

  for (const node of document.querySelectorAll('[data-ping-jitter]')) {
    node.textContent = jit == null ? '--' : `${jit} ms`;
  }

  drawChart();
}

export function refreshPing() {
  void measure();
}

export function getPingSamples() {
  return [...samples];
}

export function startPing({ socketGetter = () => null, intervalMs = INTERVAL_MS } = {}) {
  getSocket = socketGetter;
  if (started) return;
  started = true;
  void measure();
  timer = setInterval(() => void measure(), intervalMs);
  onLanguageChange(render);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void measure();
  });
}

export function stopPing() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
