/**
 * PING OP v1.1 — Node server adapter.
 *
 * attach(io) registers `ping:request` (echo + server clock + seq,
 * rate-limited to 5/s per socket) echoing { ok, t, seq, serverTime, op, version }.
 * The measurement itself (RTT) is computed by the CLIENT with a monotonic
 * clock; the server only echoes, so the shared `pingOp` instance stays
 * offline until clients report samples (e.g. via a stats POST — planned
 * v1.1). /api/health exposes the current engine state honestly as empty.
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

export function createPingServer(options = {}) {
  const pingOp = options.pingOp ?? createPingOp();
  const maxPerSocketPerSecond = options.maxPerSocketPerSecond ?? 5;

  function attach(io) {
    io.on('connection', (socket) => {
      socket.data.pingOpHits = [];
      socket.on('ping:request', (payload = {}, ack) => {
        const now = Date.now();
        const hits = (socket.data.pingOpHits = (socket.data.pingOpHits ?? []).filter((t) => now - t < 1000));
        if (hits.length >= maxPerSocketPerSecond) {
          if (typeof ack === 'function') ack({ ok: false, error: 'rate-limited' });
          return;
        }
        hits.push(now);
        const clientTime = Number(payload?.t);
        const seq = Number(payload?.seq) || 0;
        if (typeof ack === 'function') {
          ack({
            ok: true,
            t: Number.isFinite(clientTime) ? clientTime : now,
            seq,
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
    return { ...pingOp.getStats(), reported: lastReported };
  }

  return { attach, httpHandler, applyHardening, getStats, reportStats, pingOp, arabicLabel };
}

export default { createPingServer, PING_OP_VERSION, sanitizeStatsReport };
