import test from 'node:test';
import assert from 'node:assert/strict';

import { createPingOp, createPacketScheduler, PingOp, PING_OP_VERSION, qualityFor } from '../src/ping-op.js';
import { createPingServer } from '../src/server.js';

test('PING OP core: sampling, jitter, loss and score', () => {
  const op = createPingOp();
  assert.equal(PING_OP_VERSION, '1.5.0');
  assert.equal(qualityFor(40), 'good');
  assert.equal(qualityFor(120), 'fair');
  assert.equal(qualityFor(400), 'poor');
  assert.equal(qualityFor(null), 'offline');

  assert.equal(op.sample(42), 42);
  assert.equal(op.sample(48), 48);
  assert.equal(op.sample(44), 44);
  const stats = op.getStats();
  assert.equal(stats.version, '1.5.0');
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
  // v1.3: latency is still good, but heavy loss probes faster (0.75x).
  assert.equal(losses.nextIntervalMs(), 2250);
  const offline = createPingOp();
  offline.sample(null);
  assert.equal(offline.getStats().quality, 'offline');
  // v1.3: offline + total loss hits the 800ms floor.
  assert.equal(offline.nextIntervalMs(), 800);

  // Min-of-rounds display: a spike cannot poison the badge.
  const spiky = createPingOp();
  spiky.sample(50);
  spiky.sample(500);
  spiky.sample(52);
  spiky.sample(51);
  spiky.sample(49);
  assert.ok(spiky.getStats().current <= 52, 'displayed is the recent best, not the spike');
});

test('PING OP v1.3: EWMA average — a spike fades instead of haunting the mean', () => {
  const ewmaOp = createPingOp();
  ewmaOp.sample(50);
  ewmaOp.sample(500);
  const avg = ewmaOp.getStats().avg;
  // Plain mean would be 275; EWMA leans to the stable era (50 + 0.25*450).
  assert.ok(avg > 50 && avg < 200, `EWMA average should recover fast, got ${avg}`);
  ewmaOp.sample(50);
  ewmaOp.sample(50);
  const settled = ewmaOp.getStats().avg;
  assert.ok(settled < avg, 'steady rounds keep pulling the average back down');
});

test('PING OP v1.3: jitter only looks at recent samples', () => {
  const jitOp = createPingOp();
  jitOp.sample(40);
  jitOp.sample(400); // old spike
  for (let i = 0; i < 13; i += 1) jitOp.sample(40); // steady era pushes it out
  assert.equal(jitOp.getStats().jitter, 0, 'an old spike must not keep jitter high forever');
});

test('PING OP v1.4: MAD jitter ignores a single outlier', () => {
  const steady = createPingOp();
  for (let i = 0; i < 6; i += 1) steady.sample(50);
  assert.equal(steady.getStats().jitter, 0, 'a rock-stable link reports zero jitter');

  const oneSpike = createPingOp();
  oneSpike.sample(50);
  oneSpike.sample(50);
  oneSpike.sample(50);
  oneSpike.sample(900); // one wild round inside the window
  oneSpike.sample(50);
  oneSpike.sample(50);
  oneSpike.sample(50);
  assert.equal(oneSpike.getStats().jitter, 0, 'a single spike cannot inflate MAD jitter');

  const wobbly = createPingOp();
  for (const ms of [40, 80, 40, 80, 40, 80]) wobbly.sample(ms);
  assert.ok(wobbly.getStats().jitter >= 15, 'sustained instability still reads high');
});

test('PING OP v1.3: clock-drift guard re-anchors after a suspension gap', () => {
  const sleeper = createPingOp();
  sleeper.sample(50, { atMs: 1_000 });
  sleeper.sample(48, { atMs: 2_000 });
  sleeper.sample(52, { atMs: 3_000 });
  assert.equal(sleeper.getStats().current, 48);

  // 60s arrival gap = tab suspension / throttled timers / system sleep.
  sleeper.sample(120, { atMs: 63_000 });
  const after = sleeper.getStats();
  assert.equal(after.current, 120, 'post-suspension round re-anchors the badge');
  assert.equal(after.avg, 120, 'the moving average re-seeds on the fresh era');
  assert.equal(after.trend, 'stable', 'no fake trend from mixing eras');
});

test('PING OP v1.3: faster probing while the link degrades', () => {
  const stableOp = createPingOp();
  stableOp.sample(40);
  stableOp.sample(41);
  stableOp.sample(40);
  assert.equal(stableOp.nextIntervalMs(), 3000, 'stable good link keeps the calm cadence');

  const degrade = createPingOp();
  degrade.sample(50); // warmup anchor
  degrade.sample(60);
  degrade.sample(120); // rounds [60, 120] -> worsening, displayed 60 (still good)
  assert.equal(degrade.getTrend(), 'worsening');
  assert.equal(degrade.nextIntervalMs(), 2250, 'worsening trend probes 0.75x faster');
  assert.equal(degrade.getStats().intervalMs, 2250, 'getStats exposes the last cadence');
});

test('PING OP v1.3: class wrapper passes sample metadata through', () => {
  const op = new PingOp();
  op.sample(50, { atMs: 1_000 });
  op.sample(60, { atMs: 61_000 }); // suspension gap
  assert.equal(op.getStats().current, 60);
  assert.equal(op.getStats().avg, 60);
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
  assert.equal(fakeRes.payload.version, '1.5.0');
  assert.equal(fakeRes.headers['Cache-Control'], 'no-store');
  assert.equal(fakeRes.headers['X-Ping-Op'], 'ping-op/1.5.0');
});

test('PING OP v1.5: packet scheduler sends a need-aware random subset', () => {
  const scheduler = createPacketScheduler({ random: () => 0.9, maxQueue: 4 });
  for (let i = 0; i < 3; i += 1) scheduler.enqueue({ priority: 0.8, now: 1_000, ttlMs: 6_000 });
  const calm = scheduler.plan({ need: 0.2, budget: 3, now: 1_100 });
  assert.equal(calm.send.length, 1, 'a calm link sends one keep-alive packet');
  assert.equal(calm.defer.length, 2, 'the rest is deferred');
  assert.equal(scheduler.stats().deferrals, 2);

  const busy = scheduler.plan({ need: 1, budget: 3, now: 1_200 });
  assert.equal(busy.send.length, 2, 'high need spends more of the budget');
  assert.equal(busy.defer.length, 0, 'nothing left to defer');
});

test('PING OP v1.5: stale packets are deleted, not sent', () => {
  const scheduler = createPacketScheduler({ random: () => 0.9, maxQueue: 4 });
  scheduler.enqueue({ priority: 0.5, now: 1_000, ttlMs: 500 });
  const plan = scheduler.plan({ need: 1, budget: 3, now: 1_600 });
  assert.equal(plan.send.length, 0, 'expired packet is never sent');
  assert.equal(plan.dropped.length, 1, 'expired packet is reported as dropped');
  assert.equal(scheduler.stats().expired, 1);

  scheduler.enqueue({ priority: 0.2, now: 2_000 });
  scheduler.enqueue({ priority: 0.9, now: 2_000 });
  assert.equal(scheduler.cancelAll(), 2, 'calm link deletes all deferred work');
  assert.equal(scheduler.stats().cancelled, 2);
  assert.equal(scheduler.peek().length, 0);

  scheduler.enqueue({ priority: 0.1, now: 3_000 });
  scheduler.enqueue({ priority: 0.2, now: 3_000 });
  scheduler.enqueue({ priority: 0.3, now: 3_000 });
  scheduler.enqueue({ priority: 0.4, now: 3_000 });
  scheduler.enqueue({ priority: 0.5, now: 3_000 });
  assert.equal(scheduler.stats().pending, 4, 'queue stays bounded');
  assert.ok(scheduler.stats().dropped >= 1, 'least useful packet dropped');
});
