/**
 * PING OP v1.5 — core statistics engine + packet scheduler (zero deps).
 * v1.1 adds: getTrend() (improving/worsening/stable), getHealth(),
 * and sanitizeStatsReport() for safe client -> server reporting.
 * v1.2 adds: trend rides along in getStats() (was getHealth-only).
 * v1.3 adds: EWMA average, recent-window jitter, suspension re-anchoring
 * (clock-drift guard), and trend/loss-aware adaptive probing.
 * v1.4 adds: MAD jitter (median absolute deviation) — a single spike can no
 * longer inflate the jitter figure for the whole window.
 * v1.5 adds: createPacketScheduler() — probes are queued as packets, split
 * randomly by need, only the useful ones are sent now, the rest are deferred
 * with a deadline, and deferred packets that are no longer needed (or stale)
 * are deleted instead of being sent. This cuts probe traffic while keeping
 * the reading fresh exactly when the link is unstable.
 *
 * Pure math + adaptive scheduling used identically on server and client:
 * - sample(roundTripMs): records one round trip, or null for a loss/timeout
 *   - optional meta: { atMs } — arrival time used to detect suspension gaps
 * - getStats(): { current, min, avg, median, max, jitter, lossRate, quality, score, samples }
 * - getScore(): 0..100 (100 = perfect link)
 * - nextIntervalMs(): adaptive probe cadence from quality, trend and loss
 * - createPacketScheduler(): need-aware random packet split/defer/drop
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

export const PING_OP_VERSION = '1.5.1';
export const PING_OP_NAME = 'ping-op';

export const MAX_SAMPLES = 60;
export const DISPLAY_WINDOW = 4;
export const GOOD_MS = 80;
export const FAIR_MS = 180;
export const EWMA_ALPHA = 0.25;
export const JITTER_WINDOW = 12;
export const SUSPENSION_GAP_MS = 30_000;
export const MIN_INTERVAL_MS = 800;
export const OFFLINE_LOSS_THRESHOLD = 3;

// v1.5 packet scheduler limits. A "packet" is one ping probe candidate.
// The queue is deliberately tiny: latency probes are only useful while they
// are fresh, so deferring forever would just waste bandwidth and battery.
export const PACKET_MAX_QUEUE = 12;
export const PACKET_DEFER_MS = 8_000;
export const PACKET_MIN_TTL_MS = 500;
export const PACKET_MAX_TTL_MS = 30_000;
export const PACKET_MAX_SEND = 3;

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

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, Math.round(number)))
    : fallback;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * v1.5 packet scheduler.
 *
 * The client used to fire a fixed number of probes every round. That is
 * wasteful on a rock-stable link and still too slow during a spike. This
 * scheduler treats every probe as a packet with a priority and a deadline:
 *
 *   enqueue()  -> a candidate probe enters the small queue
 *   plan()     -> randomly picks the packets that are worth sending NOW
 *                 (more packets when `need` is high, usually one otherwise)
 *   deferred   -> the rest stay queued for a later round
 *   prune()    -> packets whose deadline passed are deleted, never sent
 *   cancelAll()-> packets that are no longer useful are deleted immediately
 *
 * The randomness is intentional: a fixed "2 probes at t, 2 at t+3s" pattern
 * is easy for a busy link/queue to synchronise with. A jittered subset keeps
 * measurements representative without flooding the socket.
 *
 * Pure and injectable (`random`) so it is fully unit-testable.
 */
export function createPacketScheduler({
  random = Math.random,
  maxQueue = PACKET_MAX_QUEUE,
  deferMs = PACKET_DEFER_MS
} = {}) {
  const safeMaxQueue = Math.max(1, Math.min(64, Math.round(Number(maxQueue) || PACKET_MAX_QUEUE)));
  const safeDeferMs = clamp(deferMs, PACKET_MIN_TTL_MS, PACKET_MAX_TTL_MS) || PACKET_DEFER_MS;
  let queue = [];
  let nextId = 1;
  const counters = {
    queued: 0,
    sent: 0,
    deferrals: 0,
    dropped: 0,
    expired: 0,
    cancelled: 0
  };

  function enqueue({ priority = 0.5, meta = null, now = Date.now(), ttlMs = safeDeferMs } = {}) {
    const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const ttl = clamp(ttlMs, PACKET_MIN_TTL_MS, PACKET_MAX_TTL_MS) || safeDeferMs;
    const packet = {
      id: nextId++,
      priority: clamp(priority, 0, 1),
      queuedAt: at,
      deadline: at + ttl,
      meta
    };
    queue.push(packet);
    counters.queued += 1;
    if (queue.length > safeMaxQueue) {
      // Bounded memory: drop the least useful packet (lowest priority, then
      // the oldest — it is the closest to expiry anyway).
      let worst = 0;
      for (let i = 1; i < queue.length; i += 1) {
        const a = queue[i];
        const b = queue[worst];
        if (a.priority < b.priority || (a.priority === b.priority && a.queuedAt < b.queuedAt)) worst = i;
      }
      queue.splice(worst, 1);
      counters.dropped += 1;
    }
    return packet;
  }

  function prune(now = Date.now()) {
    if (!queue.length) return [];
    const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const dropped = [];
    const keep = [];
    for (const packet of queue) {
      if (packet.deadline <= at) dropped.push(packet);
      else keep.push(packet);
    }
    if (dropped.length) {
      queue = keep;
      counters.expired += dropped.length;
    }
    return dropped;
  }

  /**
   * Split the queue into "send now" and "defer".
   * @param {object} opts
   * @param {number} opts.need 0..1 — how much fresh data the link needs
   * @param {number} opts.budget max packets this round (hard-capped)
   */
  function plan({ need = 0.5, budget = PACKET_MAX_SEND, now = Date.now() } = {}) {
    const dropped = prune(now);
    if (!queue.length) return { send: [], defer: [], dropped };
    const urgency = clamp(need, 0, 1);
    const safeBudget = Math.max(1, Math.min(PACKET_MAX_SEND, Math.round(Number(budget) || 1)));
    // Stable links send exactly one keep-alive probe; an unstable link may
    // send the whole (tiny) budget. The +1 roll adds jitter so the pattern
    // is not deterministic.
    const wanted = Math.round(urgency * safeBudget);
    const jitter = random() < urgency * 0.4 ? 1 : 0;
    const minSend = urgency >= 0.9 ? 2 : 1;
    const sendCount = Math.max(1, Math.min(queue.length, Math.max(minSend, wanted + jitter)));
    // Weighted random ranking: priority dominates, but a low-priority packet
    // occasionally goes early, which keeps the sample spread honest.
    const ranked = queue.map((packet) => ({
      packet,
      roll: random() * (1 + packet.priority * 3)
    }));
    ranked.sort((a, b) => b.roll - a.roll);
    const chosen = ranked.slice(0, sendCount).map((item) => item.packet);
    const chosenIds = new Set(chosen.map((packet) => packet.id));
    queue = queue.filter((packet) => !chosenIds.has(packet.id));
    counters.sent += chosen.length;
    if (queue.length) counters.deferrals += queue.length;
    return { send: chosen, defer: [...queue], dropped };
  }

  /** Delete specific queued packets (e.g. the link became stable). */
  function cancel(ids) {
    const set = ids instanceof Set ? ids : new Set(Array.isArray(ids) ? ids : []);
    if (!set.size || !queue.length) return 0;
    const before = queue.length;
    queue = queue.filter((packet) => !set.has(packet.id));
    const removed = before - queue.length;
    counters.cancelled += removed;
    return removed;
  }

  /** Delete every deferred packet — "we do not need them anymore". */
  function cancelAll() {
    const removed = queue.length;
    queue = [];
    counters.cancelled += removed;
    return removed;
  }

  function stats() {
    return {
      version: PING_OP_VERSION,
      pending: queue.length,
      queued: counters.queued,
      sent: counters.sent,
      deferrals: counters.deferrals,
      dropped: counters.dropped,
      expired: counters.expired,
      cancelled: counters.cancelled,
      maxQueue: safeMaxQueue
    };
  }

  function reset() {
    queue = [];
    nextId = 1;
    for (const key of Object.keys(counters)) counters[key] = 0;
  }

  return { enqueue, plan, prune, cancel, cancelAll, stats, reset, peek: () => [...queue] };
}

export function createPingOp({ maxSamples = MAX_SAMPLES, displayWindow = DISPLAY_WINDOW } = {}) {
  const safeMaxSamples = boundedInteger(maxSamples, MAX_SAMPLES, 1, MAX_SAMPLES);
  const safeDisplayWindow = boundedInteger(displayWindow, DISPLAY_WINDOW, 1, safeMaxSamples);
  const samples = []; // successful RTTs in order
  const rounds = []; // min per round (for the displayed value)
  const probes = []; // 1 per probe (true = success)
  let last = null;
  let displayed = null;
  let ewma = null;
  let warmupDone = false;
  let consecutiveLosses = 0;
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
      if (probes.length > safeMaxSamples) probes.shift();
      consecutiveLosses += 1;
      if (consecutiveLosses >= OFFLINE_LOSS_THRESHOLD) {
        last = null;
        displayed = null;
        ewma = null;
        rounds.length = 0;
        warmupDone = false;
      }
      return null;
    }
    const value = Math.max(0, Math.round(ms));
    last = value;
    samples.push(value);
    if (samples.length > safeMaxSamples) samples.shift();
    probes.push(true);
    if (probes.length > safeMaxSamples) probes.shift();
    consecutiveLosses = 0;

    if (!warmupDone || resumed) {
      warmupDone = true;
      displayed = value;
      rounds.length = 0; // drop pre-suspension values, do not mix eras
      ewma = value; // re-seed the moving average on the fresh era
    } else {
      rounds.push(value);
      if (rounds.length > safeDisplayWindow) rounds.shift();
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
    consecutiveLosses = 0;
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

export default {
  createPingOp,
  createPacketScheduler,
  PingOp,
  PING_OP_VERSION,
  PING_OP_NAME,
  qualityFor,
  sanitizeStatsReport
};
