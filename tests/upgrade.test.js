import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHushServer } from '../src/app.js';
import { spamScore, hashValue } from '../src/security.js';
import { io as ioClient } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('spam scoring blocks floods and duplicates', () => {
  assert.equal(spamScore('hello world', []).ok, true);
  assert.equal(spamScore('aaaaaaaaaaaa', []).ok, false);
  assert.equal(spamScore('https://a.com https://b.com https://c.com https://d.com', []).ok, false);
  assert.equal(spamScore('same text', [{ text: 'same text', at: Date.now() }]).ok, false);
});

test('sounds folder and changelog exist with log button', async () => {
  const changelog = JSON.parse(await readFile(path.join(PUBLIC, 'changelog.json'), 'utf8'));
  assert.ok(changelog.entries.length >= 1);
  for (const name of ['message', 'mention', 'join', 'leave', 'error', 'kick', 'ban', 'success', 'click', 'blip']) {
    const buf = await readFile(path.join(PUBLIC, 'sounds', `${name}.wav`));
    assert.ok(buf.length > 1000, `${name}.wav too small`);
    assert.equal(buf.subarray(0, 4).toString(), 'RIFF');
  }
  const index = await readFile(path.join(PUBLIC, 'index.html'), 'utf8');
  assert.match(index, /data-open-log/, 'landing log button');
  const room = await readFile(path.join(PUBLIC, 'room.html'), 'utf8');
  assert.match(room, /data-open-log/, 'room log button');
  assert.match(room, /ctx-menu/, 'admin context menu');
  const sounds = await readFile(path.join(PUBLIC, 'js', 'sounds.js'), 'utf8');
  assert.match(sounds, /\/sounds\//, 'sounds module plays files');
  const ping = await readFile(path.join(PUBLIC, 'js', 'ping.js'), 'utf8');
  assert.match(ping, /median|EWMA|ewma/i, 'ping smoothing algorithm');
  assert.match(ping, /performance\.now/, 'monotonic clock');
});

test('host can kick and ban; banned device cannot rejoin', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hush-adm-'));
  const hush = await createHushServer({ port: 0, host: '127.0.0.1', dataDir: path.join(dir, 'data'), uploadsDir: path.join(dir, 'uploads') });
  const address = await hush.start();
  const url = `http://127.0.0.1:${address.port}`;
  const code = `ADM${String(Date.now()).slice(-3)}`;
  const alice = ioClient(url, { transports: ['websocket'], forceNew: true });
  const bob = ioClient(url, { transports: ['websocket'], forceNew: true });
  const onceConnect = (s) => s.connected ? Promise.resolve() : new Promise((r, j) => { s.once('connect', r); s.once('connect_error', j); });
  const ack = (s, ev, p) => new Promise((resolve) => s.emit(ev, p, (r) => resolve(r)));
  try {
    await Promise.all([onceConnect(alice), onceConnect(bob)]);
    const a = await ack(alice, 'room:join', { code: code, name: 'Host', deviceId: 'device-host-1' });
    const b = await ack(bob, 'room:join', { code: code, name: 'Bob', deviceId: 'device-bob-1' });
    assert.equal(a.ok, true);
    assert.equal(a.isHost, true);
    assert.equal(b.ok, true);
    assert.equal(b.isHost, false);

    // Non-host cannot kick
    const denied = await ack(bob, 'admin:kick', { targetId: a.self.id });
    assert.equal(denied.ok, false);

    // Host bans Bob
    const ban = await ack(alice, 'admin:ban', { targetId: b.self.id, minutes: 60 });
    assert.equal(ban.ok, true);

    // Bob (new socket, same device) cannot rejoin
    const bob2 = ioClient(url, { transports: ['websocket'], forceNew: true });
    try {
      await onceConnect(bob2);
      const rejoin = await ack(bob2, 'room:join', { code: code, name: 'Bob2', deviceId: 'device-bob-1' });
      assert.equal(rejoin.ok, false);
      assert.equal(rejoin.error, 'banned');
    } finally { bob2.disconnect(); }
  } finally {
    alice.disconnect(); bob.disconnect();
    await hush.stop();
  }
});

test('same device twice in one room replaces the old session', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hush-dev-'));
  const hush = await createHushServer({ port: 0, host: '127.0.0.1', dataDir: path.join(dir, 'data'), uploadsDir: path.join(dir, 'uploads') });
  const address = await hush.start();
  const url = `http://127.0.0.1:${address.port}`;
  const devCode = `DEV${String(Date.now()).slice(-3)}`;
  const s1 = ioClient(url, { transports: ['websocket'], forceNew: true });
  const s2 = ioClient(url, { transports: ['websocket'], forceNew: true });
  const onceConnect = (s) => s.connected ? Promise.resolve() : new Promise((r, j) => { s.once('connect', r); s.once('connect_error', j); });
  const ack = (s, ev, p) => new Promise((resolve) => s.emit(ev, p, (r) => resolve(r)));
  try {
    await Promise.all([onceConnect(s1), onceConnect(s2)]);
    const j1 = await ack(s1, 'room:join', { code: devCode, name: 'One', deviceId: 'device-same-1' });
    assert.equal(j1.ok, true);
    const j2 = await ack(s2, 'room:join', { code: devCode, name: 'One', deviceId: 'device-same-1' });
    assert.equal(j2.ok, true);
    // Old socket should have been disconnected by the server
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(s1.connected, false);
  } finally {
    s1.disconnect(); s2.disconnect();
    await hush.stop();
  }
});

test('changelog endpoint responds', async () => {
  const hush = await createHushServer({ port: 0, host: '127.0.0.1' });
  const address = await hush.start();
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/changelog`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.entries));
  } finally { await hush.stop(); }
});
