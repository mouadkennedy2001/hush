/**
 * PING OP v1.4 — core statistics engine (written from scratch, zero deps).
 * v1.1 adds: getTrend() (improving/worsening/stable), getHealth(),
 * and sanitizeStatsReport() for safe client -> server reporting.
 * v1.2 adds: trend rides along in getStats() (was getHealth-only).
 * v1.3 adds: EWMA average, recent-window jitter, suspension re-anchoring
 * (clock-drift guard), and trend/loss-aware adaptive probing.
 * v1.4 adds: MAD jitter (median absolute deviation) — a single spike can no
 * longer inflate the jitter figure for the whole window.
 *
 * Pure math + adaptive scheduling used identically on server and client:
 * - sample(roundTripMs): records one round trip, or null for a loss/timeout
 *   - optional meta: { atMs } — arrival time used to detect suspension gaps
 * - getStats(): { current, min, avg, median, max, jitter, lossRate, quality, score, samples }
 * - getScore(): 0..100 (100 = perfect link)
 * - nextIntervalMs(): adaptive probe cadence from quality, trend and loss
 * - reset(): clears all samples
 *
 * Design (highest purity / lowest noise):
 * - Displayed value is the MIN of the last 4 rounds (a single spike cannot
 *   poison the badge, but improvements show immediately).
 * - v1.3 "average" is an EWMA (alpha 0.25): a spike fades in a handful of
 *   rounds instead of haunting a plain mean for the whole sample window.
 * - v1.3 jitter only looks at the last 12 samples: recent instability is
 *   what the user feels, old spikes should not keep jitter high forever.
 * - v1.4 jitter is the MAD (median absolute deviation) of those 12 recent
 *   samples: median-based math means one wild round barely moves the value,
 *   which is exactly how jitter should behave for a human reading a badge.
 * - Loss rate = timeouts / total probes in the window.
 * - Quality thresholds: <80ms good, <180ms fair, else poor, null offline.
 * - Score blends latency, jitter, and loss into one 0..100 number.
 * - v1.3 clock-drift guard: if two samples arrive more than 30s apart
 *   (tab suspended, system sleep, throttled timers), the display window and
 *   the EWMA re-anchor on the fresh sample — the badge never shows a stale
 *   pre-suspension value while waiting for 4 new rounds.
 * - v1.3 adaptive probing: base cadence by quality, then up to 2x faster
 *   when the trend is worsening or loss >= 20% (floor 800ms, so a busy
 *   link is never flooded).
 *
 * No I/O, no timers, no DOM — unit-testable in plain Node.
 */

export const PING_OP_VERSION = '1.4.0';
export const PING_OP_NAME = 'ping-op';

export const MAX_SAMPLES = 60;
export const DISPLAY_WINDOW = 4;
export const GOOD_MS = 80;
export const FAIR_MS = 180;
export const EWMA_ALPHA = 0.25;
export const JITTER_WINDOW = 12;
export const SUSPENSION_GAP_MS = 30_000;
export const MIN_INTERVAL_MS = 800;

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
  let ewma = null;
  let warmupDone = false;
  let lastArrivalMs = null;
  let lastIntervalMs = 3000;

  function sample(ms, { atMs = Date.now() } = {}) {
    // v1.3 clock-drift guard: a huge arrival gap means the host (tab sleep,
    // throttled timers) paused us — the next value must re-anchor the badge.
    const gapMs = lastArrivalMs == null ? 0 : atMs - lastArrivalMs;
    lastArrivalMs = atMs;
    const resumed = gapMs > SUSPENSION_GAP_MS;

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

    if (!warmupDone || resumed) {
      warmupDone = true;
      displayed = value;
      rounds.length = 0; // drop pre-suspension values, do not mix eras
      ewma = value; // re-seed the moving average on the fresh era
    } else {
      rounds.push(value);
      if (rounds.length > displayWindow) rounds.shift();
      displayed = Math.min(...rounds);
      ewma += EWMA_ALPHA * (value - ewma); // EWMA: recent rounds weigh more
    }
    return value;
  }

  function jitter() {
    if (samples.length < 2) return null;
    const recent = samples.slice(-JITTER_WINDOW);
    const center = median(recent);
    // v1.4 MAD: median absolute deviation from the window median. A mean or
    // mean-delta would let one spike inflate the reading; the median-based
    // version ignores it, which matches how instability actually feels.
    const deviations = recent.map((value) => Math.abs(value - center));
    return Math.round(median(deviations));
  }

  function lossRate() {
    if (!probes.length) return 0;
    const lost = probes.filter((ok) => !ok).length;
    return Math.round((lost / probes.length) * 100);
  }

  function average() {
    if (ewma == null) return null;
    return Math.round(ewma);
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
    let base = q === 'good' ? 3000 : q === 'fair' ? 2000 : q === 'poor' ? 1200 : 900;
    // v1.3: probe faster while the link is degrading (trend worsening or
    // real packet loss), so recovery/decay shows sooner — but never flood.
    if (getTrend() === 'worsening') base *= 0.75;
    if (lossRate() >= 20) base *= 0.75;
    const ms = Math.max(MIN_INTERVAL_MS, Math.round(base / 50) * 50);
    lastIntervalMs = ms;
    return ms;
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
      // v1.3: last cadence the engine recommended (debug dashboards).
      intervalMs: lastIntervalMs,
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
    ewma = null;
    warmupDone = false;
    lastArrivalMs = null;
    lastIntervalMs = 3000;
  }

  return { sample, getStats, getHealth, getTrend, getScore, nextIntervalMs, getSamples, reset };
}

export class PingOp {
  #engine;
  constructor(options) {
    this.#engine = createPingOp(options);
  }
  sample(ms, meta) { return this.#engine.sample(ms, meta); }
  getStats() { return this.#engine.getStats(); }
  getScore() { return this.#engine.getScore(); }
  getHealth() { return this.#engine.getHealth(); }
  getTrend() { return this.#engine.getTrend(); }
  nextIntervalMs() { return this.#engine.nextIntervalMs(); }
  getSamples() { return this.#engine.getSamples(); }
  reset() { return this.#engine.reset(); }
}

export default { createPingOp, PingOp, PING_OP_VERSION, PING_OP_NAME, qualityFor, sanitizeStatsReport };
