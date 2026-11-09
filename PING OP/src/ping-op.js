/**
 * PING OP v1.1 — core statistics engine (written from scratch, zero deps).
 * v1.1 adds: getTrend() (improving/worsening/stable), getHealth(),
 * and sanitizeStatsReport() for safe client -> server reporting.
 *
 * Pure math + adaptive scheduling used identically on server and client:
 * - sample(roundTripMs): records one round trip, or null for a loss/timeout
 * - getStats(): { current, min, avg, median, max, jitter, lossRate, quality, score, samples }
 * - getScore(): 0..100 (100 = perfect link)
 * - nextIntervalMs(): adaptive probe cadence from the current quality
 * - reset(): clears all samples
 *
 * Design (highest purity / lowest noise):
 * - Displayed value is the MIN of the last 4 rounds (a single spike cannot
 *   poison the badge, but improvements show immediately).
 * - Jitter = mean absolute delta between consecutive samples.
 * - Loss rate = timeouts / total probes in the window.
 * - Quality thresholds: <80ms good, <180ms fair, else poor, null offline.
 * - Score blends latency, jitter, and loss into one 0..100 number.
 *
 * No I/O, no timers, no DOM — unit-testable in plain Node.
 */

export const PING_OP_VERSION = '1.2.0';
export const PING_OP_NAME = 'ping-op';

export const MAX_SAMPLES = 60;
export const DISPLAY_WINDOW = 4;
export const GOOD_MS = 80;
export const FAIR_MS = 180;

/** v1.1: validate a client-reported stats object. Numbers only, clamped —
 *  a malicious client can never store strings/HTML through this path. */
export function sanitizeStatsReport(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
  };
  const quality = ['good', 'fair', 'poor', 'offline'].includes(raw.quality) ? raw.quality : 'offline';
  return {
    current: num(raw.current, 0, 10000),
    avg: num(raw.avg, 0, 10000),
    median: num(raw.median, 0, 10000),
    jitter: num(raw.jitter, 0, 10000),
    lossRate: num(raw.lossRate, 0, 100),
    score: num(raw.score, 0, 100),
    quality,
    samplesCount: num(raw.samplesCount, 0, 1000)
  };
}

export function qualityFor(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'offline';
  if (ms < GOOD_MS) return 'good';
  if (ms < FAIR_MS) return 'fair';
  return 'poor';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function createPingOp({ maxSamples = MAX_SAMPLES, displayWindow = DISPLAY_WINDOW } = {}) {
  const samples = []; // successful RTTs in order
  const rounds = []; // min per round (for the displayed value)
  const probes = []; // 1 per probe (true = success)
  let last = null;
  let displayed = null;
  let warmupDone = false;

  function sample(ms) {
    if (ms == null || !Number.isFinite(ms)) {
      probes.push(false);
      if (probes.length > maxSamples) probes.shift();
      return null;
    }
    const value = Math.max(0, Math.round(ms));
    last = value;
    samples.push(value);
    if (samples.length > maxSamples) samples.shift();
    probes.push(true);
    if (probes.length > maxSamples) probes.shift();

    if (!warmupDone) {
      warmupDone = true;
      displayed = value;
    } else {
      rounds.push(value);
      if (rounds.length > displayWindow) rounds.shift();
      displayed = Math.min(...rounds);
    }
    return value;
  }

  function jitter() {
    if (samples.length < 2) return null;
    let total = 0;
    for (let i = 1; i < samples.length; i += 1) total += Math.abs(samples[i] - samples[i - 1]);
    return Math.round(total / (samples.length - 1));
  }

  function lossRate() {
    if (!probes.length) return 0;
    const lost = probes.filter((ok) => !ok).length;
    return Math.round((lost / probes.length) * 100);
  }

  function average() {
    if (!samples.length) return null;
    return Math.round(samples.reduce((sum, v) => sum + v, 0) / samples.length);
  }

  function getScore() {
    if (displayed == null) return 0;
    // Latency part: 100 at 0ms -> 0 at 300ms+.
    const latency = clamp(100 - (displayed / 300) * 100, 0, 100);
    const jit = jitter();
    const jitterPart = jit == null ? 100 : clamp(100 - jit, 0, 100);
    const loss = lossRate();
    const lossPart = clamp(100 - loss * 3, 0, 100);
    return Math.round(latency * 0.6 + jitterPart * 0.2 + lossPart * 0.2);
  }

  function nextIntervalMs() {
    const q = qualityFor(displayed);
    if (q === 'good') return 3000;
    if (q === 'fair') return 2000;
    if (q === 'poor') return 1200;
    return 900;
  }

  function getStats() {
    return {
      version: PING_OP_VERSION,
      last,
      current: displayed,
      min: samples.length ? Math.min(...samples) : null,
      avg: average(),
      median: median(samples),
      max: samples.length ? Math.max(...samples) : null,
      jitter: jitter(),
      lossRate: lossRate(),
      quality: qualityFor(displayed),
      score: getScore(),
      // v1.2: trend rides along in getStats (was getHealth-only), so
      // /api/health ping dashboards get improving/worsening for free.
      trend: getTrend(),
      samplesCount: samples.length
    };
  }

  function getSamples() {
    return [...samples];
  }

  // v1.1: trend of the displayed value over recent rounds.
  function getTrend() {
    if (rounds.length < 2) return 'stable';
    const first = rounds[0];
    const lastRound = rounds[rounds.length - 1];
    if (lastRound < first - 10) return 'improving';
    if (lastRound > first + 10) return 'worsening';
    return 'stable';
  }

  function getHealth() {
    const stats = getStats();
    return { ...stats, trend: getTrend(), healthy: stats.quality === 'good' || stats.quality === 'fair' };
  }

  function reset() {
    samples.length = 0;
    rounds.length = 0;
    probes.length = 0;
    last = null;
    displayed = null;
    warmupDone = false;
  }

  return { sample, getStats, getHealth, getTrend, getScore, nextIntervalMs, getSamples, reset };
}

export class PingOp {
  #engine;
  constructor(options) {
    this.#engine = createPingOp(options);
  }
  sample(ms) { return this.#engine.sample(ms); }
  getStats() { return this.#engine.getStats(); }
  getScore() { return this.#engine.getScore(); }
  getHealth() { return this.#engine.getHealth(); }
  getTrend() { return this.#engine.getTrend(); }
  nextIntervalMs() { return this.#engine.nextIntervalMs(); }
  getSamples() { return this.#engine.getSamples(); }
  reset() { return this.#engine.reset(); }
}

export default { createPingOp, PingOp, PING_OP_VERSION, PING_OP_NAME, qualityFor, sanitizeStatsReport };
