/**
 * PING OP v1.4 — browser client (written from scratch, zero deps).
 * v1.1 adds: periodic stats reporting to POST /api/ping/stats.
 * v1.3 adds: trend-aware quality display and the core's clock-drift guard —
 * rounds measured across a tab suspension / throttled timer no longer blend
 * with the pre-suspension era (the engine re-anchors via arrival gaps).
 * v1.4 adds: requestAnimationFrame chart with a dirty flag (one draw per
 * frame at most), quadratic midpoint smoothing, and cached DOM writes
 * (textContent/dataset/title only change when the value really changed).
 *
 * - 2 parallel probes per round, take the MIN (kills polling jitter)
 * - displayed value = min of last 4 rounds, adaptive interval
 *   (good 3s / fair 2s / poor 1.2s / offline 0.9s — up to ~2x faster while
 *   the trend is worsening or loss >= 20%, floored at 800ms)
 * - monotonic clock (performance.now), 1 warmup round discarded
 * - paused while the tab is hidden, chart only redraws when visible
 * - prefers Socket.IO round-trip (`ping:request`), falls back to
 *   GET /api/ping
 *
 * Mirrored to public/js/ping-op/client.js (the browser cannot import
 * from the repo-root folder, the server only serves public/).
 */

import { createPingOp, PING_OP_VERSION } from './ping-op.js';

export { PING_OP_VERSION };

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

// v1.3: one plain word for the trend, shown next to the quality label.
function trendLabel(trend) {
  if (trend === 'improving') return 'Improving';
  if (trend === 'worsening') return 'Worsening';
  return 'Stable';
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
  // No meta needed: the core stamps arrivals itself (Date.now) and its
  // clock-drift guard re-anchors stats when a gap > 30s is detected.
  engine.sample(ms);
  render();
  scheduleNext();
}

function scheduleNext() {
  if (!started) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void measure(), engine.nextIntervalMs());
}

// v1.4: cache DOM writes — render() runs every probe round but text nodes
// only change when the number/word really changed. A WeakMap keeps this
// allocation-free and lets the nodes be collected normally.
const textCache = new WeakMap();
const badgeCache = new WeakMap();

function setText(node, value) {
  if (textCache.get(node) === value) return;
  textCache.set(node, value);
  node.textContent = value;
}

function setBadgeState(badge, quality, trend, label) {
  const prev = badgeCache.get(badge);
  if (prev?.quality !== quality) badge.dataset.quality = quality;
  if (prev?.trend !== trend) badge.dataset.trend = trend;
  if (prev?.label !== label) {
    badge.title = label;
    badge.setAttribute('aria-label', label);
  }
  badgeCache.set(badge, { quality, trend, label });
}

// v1.4: coalesce chart painting into one animation frame (dirty flag).
let chartFrame = 0;
let chartDirty = false;

function requestChartDraw() {
  chartDirty = true;
  if (chartFrame) return;
  const schedule = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 16);
  chartFrame = schedule(() => {
    chartFrame = 0;
    if (!chartDirty) return;
    chartDirty = false;
    drawChart();
  });
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
  const points = samples.map((value, index) => ({
    x: startX + stepX * index,
    y: height - 4 - (value / max) * (height - 10)
  }));
  // v1.4: quadratic midpoint smoothing — soft curve instead of a jagged
  // polyline, without any extra dependency (classic canvas smoothing pass).
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  const lastPoint = points[points.length - 1];
  const prevPoint = points[points.length - 2];
  ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, lastPoint.x, lastPoint.y);
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(lastPoint.x, lastPoint.y, 2.6, 0, Math.PI * 2);
  ctx.fillStyle = line;
  ctx.fill();
}

function render() {
  const stats = engine.getStats();
  const quality = stats.quality;
  const trend = trendLabel(stats.trend);
  const qualityText = `${qualityLabel(quality)} · ${trend}`;
  const badgeLabel = `Ping: ${qualityText}`;
  for (const badge of document.querySelectorAll('[data-ping-badge]')) {
    setBadgeState(badge, quality, stats.trend, badgeLabel);
  }
  for (const node of document.querySelectorAll('[data-ping-value]')) {
    setText(node, stats.current == null ? '-- ms' : `${stats.current} ms`);
  }
  for (const node of document.querySelectorAll('[data-ping-quality]')) {
    setText(node, qualityLabel(quality));
  }
  for (const node of document.querySelectorAll('[data-ping-trend]')) {
    setText(node, trend);
  }
  for (const node of document.querySelectorAll('[data-ping-avg]')) {
    setText(node, stats.avg == null ? '--' : `${stats.avg} ms`);
  }
  for (const node of document.querySelectorAll('[data-ping-median]')) {
    setText(node, stats.median == null ? '--' : `${stats.median} ms`);
  }
  for (const node of document.querySelectorAll('[data-ping-jitter]')) {
    setText(node, stats.jitter == null ? '--' : `${stats.jitter} ms`);
  }
  requestChartDraw();
}

export function refreshPing() { engine.reset(); if (timer) clearTimeout(timer); void measure(); }
export function getPingSamples() { return [...engine.getSamples()]; }
export function getPingModel() {
  const s = engine.getStats();
  const health = typeof engine.getHealth === 'function' ? engine.getHealth() : s;
  return { last: s.last, displayed: s.current, median: s.median, avg: s.avg, jitter: s.jitter, quality: s.quality, score: s.score, trend: health.trend || 'stable', version: PING_OP_VERSION };
}

// v1.1: report aggregated stats to the server (throttled, best-effort).
let lastReportAt = 0;
export async function reportPingStats({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastReportAt < 30_000) return false;
  lastReportAt = now;
  try {
    const s = engine.getStats();
    await fetch('/api/ping/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current: s.current, avg: s.avg, median: s.median, jitter: s.jitter,
        lossRate: s.lossRate, score: s.score, quality: s.quality, samplesCount: s.samplesCount
      }),
      keepalive: true
    });
    return true;
  } catch { return false; }
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

export default { startPing, stopPing, refreshPing, getPingModel, getPingSamples, reportPingStats, PING_OP_VERSION };
