/**
 * PING OP v1.0 — browser client (written from scratch, zero deps).
 *
 * - 2 parallel probes per round, take the MIN (kills polling jitter)
 * - displayed value = min of last 4 rounds, adaptive interval
 *   (good 3s / fair 2s / poor 1.2s / offline 0.9s)
 * - monotonic clock (performance.now), 1 warmup round discarded
 * - paused while the tab is hidden, chart only redraws when visible
 * - prefers Socket.IO round-trip (`ping:request`), falls back to
 *   GET /api/ping
 *
 * Mirrored to public/js/ping-op/client.js (the browser cannot import
 * from the repo-root folder, the server only serves public/).
 */

import { createPingOp } from './ping-op.js';

export const PING_OP_VERSION = '1.0.0';

const TIMEOUT_MS = 1500;
const MAX_SAMPLES = 60;
const PROBES = 2;

let started = false;
let getSocket = () => null;
let timer = null;
let seq = 0;
let engine = createPingOp({ maxSamples: MAX_SAMPLES });

function nowMono() { return performance.now(); }

function qualityLabel(quality) {
  // t is injected by the host page; keep a safe fallback.
  const labels = {
    good: 'Excellent',
    fair: 'Fair',
    poor: 'Poor',
    offline: 'Offline'
  };
  return labels[quality] ?? labels.offline;
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
  return Math.min(...results);
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
  engine.sample(ms);
  render();
  scheduleNext();
}

function scheduleNext() {
  if (!started) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void measure(), engine.nextIntervalMs());
}

function drawChart() {
  const canvas = document.querySelector('[data-ping-chart]');
  if (!canvas) return;
  if (canvas.offsetParent === null && !canvas.closest('.panel-people')) return;
  const panel = canvas.closest('.panel-people');
  if (panel && panel.hidden) return;
  const samples = engine.getSamples();
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
  const stats = engine.getStats();
  const quality = stats.quality;
  for (const badge of document.querySelectorAll('[data-ping-badge]')) {
    badge.dataset.quality = quality;
  }
  for (const node of document.querySelectorAll('[data-ping-value]')) {
    node.textContent = stats.current == null ? '-- ms' : `${stats.current} ms`;
  }
  for (const node of document.querySelectorAll('[data-ping-quality]')) {
    node.textContent = qualityLabel(quality);
  }
  for (const node of document.querySelectorAll('[data-ping-avg]')) {
    node.textContent = stats.avg == null ? '--' : `${stats.avg} ms`;
  }
  for (const node of document.querySelectorAll('[data-ping-median]')) {
    node.textContent = stats.median == null ? '--' : `${stats.median} ms`;
  }
  for (const node of document.querySelectorAll('[data-ping-jitter]')) {
    node.textContent = stats.jitter == null ? '--' : `${stats.jitter} ms`;
  }
  drawChart();
}

export function refreshPing() { engine.reset(); if (timer) clearTimeout(timer); void measure(); }
export function getPingSamples() { return [...engine.getSamples()]; }
export function getPingModel() {
  const s = engine.getStats();
  return { last: s.last, displayed: s.current, median: s.median, avg: s.avg, jitter: s.jitter, quality: s.quality, score: s.score, version: PING_OP_VERSION };
}

export function startPing({ socketGetter = () => null } = {}) {
  getSocket = socketGetter;
  if (started) return;
  started = true;
  void measure();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void measure();
  });
}

export function stopPing() {
  if (timer) clearTimeout(timer);
  timer = null;
  started = false;
}

export default { startPing, stopPing, refreshPing, getPingModel, getPingSamples, PING_OP_VERSION };
