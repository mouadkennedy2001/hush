import { t, onLanguageChange } from './i18n.js';
import { createPingOp, PING_OP_VERSION } from './ping-op/ping-op.js';

// Live latency ("ping") meter — powered by PING OP v1.4 (see PING OP/src/client.js):
// - 2 parallel probes per round, take the MIN (best) RTT — kills
//   polling/queue jitter without flooding the server (v3 used 3, which
//   added contention and raised the very ping it was measuring)
// - one shared engine for the badge AND the stats (v1.3): displayed value,
//   average, median, jitter, quality and score all come from the same model,
//   so the Connection card can never disagree with the badge
// - displayed value = min of last 4 rounds; "average" is an EWMA and jitter
//   is the MAD of the last 12 samples (v1.4) — a single wild round no longer
//   inflates the reading, which is what recent instability actually feels like
// - clock-drift guard: rounds that arrive > 30s apart (tab suspension,
//   system sleep, throttled timers) re-anchor the stats instead of blending
//   two eras — no stale pre-suspension value, no poisoned averages
// - adaptive interval from quality AND trend AND loss: up to ~2x faster
//   probing while the link degrades (floored at 800ms)
// - monotonic clock (performance.now), only 1 warmup round discarded
// - paused while the tab is hidden (no wasted probes / battery)
// - chart only redraws when the People panel is visible, is coalesced into
//   one requestAnimationFrame per update, and uses quadratic smoothing (v1.4)
// - DOM writes are cached: text nodes change only when the value changed
// Prefers Socket.IO round-trip; falls back to GET /api/ping.
// NOTE: ping measures real network RTT — it cannot go below physics.
// The server-side wins (TCP_NODELAY, 5s heartbeat) are in src/app.js.
// Statistics (min/avg/median/jitter/loss/score/trend) come from the PING OP core engine.

const TIMEOUT_MS = 1500;
const CHART_SAMPLES = 24;
const PROBES = 2;

let started = false;
let getSocket = () => null;
let timer = null;
let seq = 0;
const pingOp = createPingOp({ maxSamples: 60 });
export const PING_OP_UI_VERSION = PING_OP_VERSION;

function nowMono() { return performance.now(); }

function qualityLabel(quality) {
  switch (quality) {
    case 'good': return t('ping.good');
    case 'fair': return t('ping.fair');
    case 'poor': return t('ping.poor');
    default: return t('ping.offline');
  }
}

function trendLabel(trend) {
  if (trend === 'improving') return t('ping.improving');
  if (trend === 'worsening') return t('ping.worsening');
  return t('ping.stable');
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
  // No meta needed: the core stamps arrivals itself (Date.now) and its
  // clock-drift guard re-anchors the stats when a gap > 30s is detected
  // (tab suspension / throttled timers / system sleep).
  pingOp.sample(ms);
  render();
  scheduleNext();
}

function scheduleNext() {
  if (!started) return;
  if (timer) clearTimeout(timer);
  // v1.3: cadence comes from the engine — quality + trend + loss aware.
  timer = setTimeout(() => void measure(), pingOp.nextIntervalMs());
}

// v1.4: cache DOM writes — render() runs every probe round but text nodes
// only change when the number/word really changed.
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
  // Skip the canvas work when the panel holding it is hidden.
  if (canvas.offsetParent === null && !canvas.closest('.panel-people')) return;
  const panel = canvas.closest('.panel-people');
  if (panel && panel.hidden) return;
  const samples = pingOp.getSamples().slice(-CHART_SAMPLES);
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
  const stepX = width / (CHART_SAMPLES - 1);
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
  // v1.3: one stats snapshot feeds the badge, the card and the report —
  // the Connection card can never disagree with the badge again.
  const stats = pingOp.getStats();
  const quality = stats.quality;
  const trend = trendLabel(stats.trend);
  const qualityText = `${qualityLabel(quality)} · ${trend}`;
  const badgeLabel = `${t('ping.label')}: ${qualityText}`;
  reportStatsThrottled(stats);
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

let lastReportAt = 0;
function reportStatsThrottled(stats) {
  // PING OP 1.1+: tell the server our aggregated latency so /api/health
  // shows real client-measured stats (numbers only, server clamps).
  const now = Date.now();
  if (now - lastReportAt < 30_000) return;
  lastReportAt = now;
  try {
    fetch('/api/ping/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current: stats.current, avg: stats.avg, median: stats.median, jitter: stats.jitter,
        lossRate: stats.lossRate, score: stats.score, quality: stats.quality, samplesCount: stats.samplesCount
      }),
      keepalive: true
    }).catch(() => {});
  } catch { /* best-effort */ }
}

export function refreshPing() { pingOp.reset(); if (timer) clearTimeout(timer); void measure(); }
export function getPingSamples() { return pingOp.getSamples(); }
export function getPingOpStats() { return pingOp.getStats(); }
export function getPingModel() {
  const op = pingOp.getStats();
  return { last: op.last, displayed: op.current, median: op.median, avg: op.avg, jitter: op.jitter, quality: op.quality, score: op.score, trend: op.trend, version: PING_OP_VERSION };
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
