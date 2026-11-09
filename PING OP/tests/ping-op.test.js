import test from 'node:test';
import assert from 'node:assert/strict';

import { createPingOp, PingOp, PING_OP_VERSION, qualityFor } from '../src/ping-op.js';
import { createPingServer } from '../src/server.js';

test('PING OP core: sampling, jitter, loss and score', () => {
  const op = createPingOp();
  assert.equal(PING_OP_VERSION, '1.2.0');
  assert.equal(qualityFor(40), 'good');
  assert.equal(qualityFor(120), 'fair');
  assert.equal(qualityFor(400), 'poor');
  assert.equal(qualityFor(null), 'offline');

  assert.equal(op.sample(42), 42);
  assert.equal(op.sample(48), 48);
  assert.equal(op.sample(44), 44);
  const stats = op.getStats();
  assert.equal(stats.version, '1.2.0');
  assert.equal(typeof stats.current, 'number');
  assert.equal(stats.min, 42);
  assert.equal(stats.max, 48);
  assert.ok(stats.jitter >= 0);
  assert.equal(stats.lossRate, 0);
  assert.ok(stats.score >= 0 && stats.score <= 100);
  assert.ok(['good', 'fair', 'poor'].includes(stats.quality));

  // Loss + adaptive interval.
  const losses = createPingOp();
  losses.sample(30);
  losses.sample(null);
  losses.sample(null);
  assert.ok(losses.getStats().lossRate > 0);
  assert.equal(losses.nextIntervalMs(), 3000); // still good latency
  const offline = createPingOp();
  offline.sample(null);
  assert.equal(offline.getStats().quality, 'offline');
  assert.equal(offline.nextIntervalMs(), 900);

  // Min-of-rounds display: a spike cannot poison the badge.
  const spiky = createPingOp();
  spiky.sample(50);
  spiky.sample(500);
  spiky.sample(52);
  spiky.sample(51);
  spiky.sample(49);
  assert.ok(spiky.getStats().current <= 52, 'displayed is the recent best, not the spike');
});

test('PING OP server adapter: hardening + http handler shape', async () => {
  const pingServer = createPingServer();
  assert.equal(typeof pingServer.attach, 'function');
  assert.equal(typeof pingServer.httpHandler, 'function');
  assert.equal(typeof pingServer.applyHardening, 'function');
  const fakeRes = {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    json(payload) { this.payload = payload; return this; }
  };
  pingServer.httpHandler({}, fakeRes);
  assert.equal(fakeRes.payload.ok, true);
  assert.equal(fakeRes.payload.op, 'ping-op');
  assert.equal(fakeRes.payload.version, '1.2.0');
  assert.equal(fakeRes.headers['Cache-Control'], 'no-store');
  assert.equal(fakeRes.headers['X-Ping-Op'], 'ping-op/1.2.0');
});
