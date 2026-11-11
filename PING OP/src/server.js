/**
 * PING OP v1.5 — Node server adapter.
 *
 * attach(io) registers `ping:request` (echo + server clock + seq,
 * rate-limited per socket) echoing { ok, t, seq, serverTime, op, version }.
 * The measurement itself (RTT) is computed by the CLIENT with a monotonic
 * clock; the server only echoes, so the shared `pingOp` instance stays
 * offline until clients report samples via POST /api/ping/stats.
 *
 * v1.5 hardening:
 * - the payload is validated and clamped before it reaches the ack
 *   (seq/t/queuedAt/packetId are numbers only, no object passthrough)
 * - a probe that waited too long in the client's defer queue is rejected
 *   with `error: 'stale'` instead of producing a meaningless RTT
 * - the per-socket rate limiter is a shift-queue (O(1) amortised, no array
 *   allocation per probe) and keeps a small traffic counter for /api/health
 * - the HTTP handler sends `nosniff` in addition to no-store
 *
 * Server hardening (applyHardening):
 * - TCP_NODELAY on every accepted socket (kills Nagle 40ms stall)
 * - short keep-alive timeouts (recycle fast, less buffer-bloat)
 * - CORS disabled (same-origin only) — see src/app.js
 *
 * Zero dependencies. Written from scratch for Hush.
 */

import { createPingOp, PING_OP_VERSION, PING_OP_NAME, sanitizeStatsReport } from './ping-op.js';

export { PING_OP_VERSION, PING_OP_NAME };

const MAX_SEQ = 2_147_483_647;
const MAX_FUTURE_SKEW_MS = 60_000;

/** Validate a probe payload. Numbers only, clamped — never pass objects on. */
export function sanitizeProbePayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const now = Date.now();
  const number = (value, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : null;
  };
  // Missing seq is treated as 0 (older clients) — never as an error.
  const seq = number(raw.seq, 0, MAX_SEQ) ?? 0;
  const t = number(raw.t, 0, now + MAX_FUTURE_SKEW_MS);
  const queuedAt = number(raw.queuedAt, 0, now + MAX_FUTURE_SKEW_MS);
  const packetId = number(raw.packetId, 0, MAX_SEQ);
  return { seq, t, queuedAt, packetId };
}

export function createPingServer(options = {}) {
  const pingOp = options.pingOp ?? createPingOp();
  const maxPerSocketPerSecond = Math.max(1, Math.min(50, Math.round(Number(options.maxPerSocketPerSecond) || 5)));
  const maxPacketAgeMs = Math.max(1000, Math.min(120_000, Number(options.maxPacketAgeMs) || 30_000));
  const traffic = { received: 0, answered: 0, rateLimited: 0, stale: 0, invalid: 0 };

  function attach(io) {
    io.on('connection', (socket) => {
      socket.data.pingOpHits = [];
      socket.on('ping:request', (payload = {}, ack) => {
        traffic.received += 1;
        const now = Date.now();
        // Shift-queue: drop hits older than the 1s window from the front.
        const hits = (socket.data.pingOpHits = socket.data.pingOpHits ?? []);
        while (hits.length && now - hits[0] >= 1000) hits.shift();
        if (hits.length >= maxPerSocketPerSecond) {
          traffic.rateLimited += 1;
          if (typeof ack === 'function') ack({ ok: false, error: 'rate-limited' });
          return;
        }
        hits.push(now);
        const probe = sanitizeProbePayload(payload);
        if (!probe) {
          traffic.invalid += 1;
          if (typeof ack === 'function') ack({ ok: false, error: 'bad-request' });
          return;
        }
        // A deferred probe that waited too long measures queue age, not the
        // network. Reject it so the client can drop that packet cleanly.
        if (probe.queuedAt != null && now - probe.queuedAt > maxPacketAgeMs) {
          traffic.stale += 1;
          if (typeof ack === 'function') ack({ ok: false, error: 'stale', seq: probe.seq });
          return;
        }
        traffic.answered += 1;
        if (typeof ack === 'function') {
          ack({
            ok: true,
            t: probe.t ?? now,
            seq: probe.seq,
            serverTime: now,
            op: PING_OP_NAME,
            version: PING_OP_VERSION
          });
        }
      });
    });
    return pingOp;
  }

  function httpHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Ping-Op', `${PING_OP_NAME}/${PING_OP_VERSION}`);
    res.json({ ok: true, time: Date.now(), op: PING_OP_NAME, version: PING_OP_VERSION });
  }

  // Arabic label for the UI badge: OP = Optimizer = تحسين.
  function arabicLabel() {
    return 'PING OP — تحسين البنق';
  }

  function applyHardening(server) {
    if (!server) return;
    server.keepAliveTimeout = 30_000;
    server.headersTimeout = 35_000;
    server.on('connection', (socket) => {
      try { socket.setNoDelay?.(true); } catch { /* ignore */ }
    });
  }

  // v1.1: last stats reported by a client (POST /api/ping/stats).
  let lastReported = null;
  function reportStats(raw) {
    const clean = sanitizeStatsReport(raw);
    if (!clean) return null;
    lastReported = { ...clean, at: Date.now() };
    return lastReported;
  }

  function getStats() {
    return { ...pingOp.getStats(), reported: lastReported, traffic: { ...traffic } };
  }

  return { attach, httpHandler, applyHardening, getStats, reportStats, pingOp, arabicLabel };
}

export default {
  createPingServer,
  PING_OP_VERSION,
  sanitizeStatsReport,
  sanitizeProbePayload
};
