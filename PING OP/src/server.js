/**
 * PING OP v1.0 — Node server adapter.
 *
 * attachPing(io, { pingOp }) registers:
 * - `ping:request` socket handler (echo + server clock + seq, rate-limited)
 *   echoing { ok, t, seq, serverTime, op, version }
 *
 * pingHttpHandler() returns an Express/Connect-style (req, res) handler for
 * GET /api/ping: { ok:true, time, op, version } with no-store headers and
 * Cache-Control. The handler feeds a shared PingOp instance so the server
 * keeps a global latency picture (useful for /api/health).
 *
 * Server hardening lives here (applyPingHardening(server)):
 * - TCP_NODELAY on every accepted socket (kills Nagle 40ms stall)
 * - short keep-alive timeouts (recycle fast, less buffer-bloat)
 * - CORS disabled (same-origin only)
 *
 * Zero dependencies. Written from scratch for Hush.
 */

import { createPingOp, PING_OP_VERSION, PING_OP_NAME } from './ping-op.js';

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

  function getStats() {
    return pingOp.getStats();
  }

  return { attach, httpHandler, applyHardening, getStats, pingOp, arabicLabel };
}

export default { createPingServer, PING_OP_VERSION };
