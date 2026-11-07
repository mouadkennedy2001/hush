import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHushServer } from '../src/app.js';
import { SOUNDBOARD_IDS, SOUNDBOARD_SET } from '../src/constants.js';
import { io as ioClient } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('soundboard allow-list matches the client board', async () => {
  assert.equal(SOUNDBOARD_IDS.length, 16);
  const board = await readFile(path.join(PUBLIC, 'js', 'soundboard.js'), 'utf8');
  for (const id of SOUNDBOARD_IDS) {
    assert.ok(board.includes(`'${id}'`), `client board is missing ${id}`);
  }
  const room = await readFile(path.join(PUBLIC, 'room.html'), 'utf8');
  assert.match(room, /id="soundboard-panel"/, 'soundboard panel in room');
  assert.match(room, /id="soundboard-btn"/, 'soundboard button in room');
  const css = await readFile(path.join(PUBLIC, 'css', 'room.css'), 'utf8');
  assert.match(css, /\.soundboard-grid/, 'soundboard styles');
  assert.match(css, /\.ctx-volume/, 'per-peer volume styles');
});

test('server relays a valid soundboard sound and rejects unknown ids', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hush-board-'));
  const hush = await createHushServer({ port: 0, host: '127.0.0.1', dataDir: path.join(dir, 'data'), uploadsDir: path.join(dir, 'uploads') });
  const address = await hush.start();
  const url = `http://127.0.0.1:${address.port}`;
  const code = `BRD${String(Date.now()).slice(-3)}`;
  const alice = ioClient(url, { transports: ['websocket'] });
  const bob = ioClient(url, { transports: ['websocket'] });
  const onceConnect = (s) => s.connected ? Promise.resolve() : new Promise((r, j) => { s.once('connect', r); s.once('connect_error', j); });
  const ack = (s, ev, p) => new Promise((resolve) => s.emit(ev, p, (r) => resolve(r)));
  try {
    await Promise.all([onceConnect(alice), onceConnect(bob)]);
    await ack(alice, 'room:join', { code, name: 'Host', deviceId: 'device-board-1' });
    await ack(bob, 'room:join', { code, name: 'Bob', deviceId: 'device-board-2' });

    const heard = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('soundboard relay timeout')), 4000);
      bob.once('soundboard:play', (payload) => { clearTimeout(timer); resolve(payload); });
    });
    const sent = await ack(alice, 'soundboard:play', { id: SOUNDBOARD_IDS[0] });
    assert.equal(sent.ok, true);
    const payload = await heard;
    assert.equal(payload.id, SOUNDBOARD_IDS[0]);
    assert.ok(SOUNDBOARD_SET.has(payload.id));

    const bad = await ack(alice, 'soundboard:play', { id: 'not-a-real-sound' });
    assert.equal(bad.ok, false);

    // The relay must not reach a client in a different room.
    const carol = ioClient(url, { transports: ['websocket'] });
    try {
      await onceConnect(carol);
      await ack(carol, 'room:join', { code: `OTH${String(Date.now()).slice(-3)}`, name: 'Carol', deviceId: 'device-board-3' });
      let leaked = false;
      carol.on('soundboard:play', () => { leaked = true; });
      await ack(alice, 'soundboard:play', { id: SOUNDBOARD_IDS[1] });
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(leaked, false, 'soundboard leaked into another room');
    } finally { carol.disconnect(); }
  } finally {
    alice.disconnect(); bob.disconnect();
    await hush.stop();
  }
});

test('per-peer volume uses gain nodes above 100 percent', async () => {
  const media = await readFile(path.join(PUBLIC, 'js', 'room', 'media.js'), 'utf8');
  assert.match(media, /createGain/, 'WebAudio gain for boost above 100%');
  assert.match(media, /setPeerVolume/, 'mesh exposes per-peer volume');
  assert.match(media, /setMasterVolume/, 'mesh exposes master volume');
  assert.match(media, /setDeafened/, 'mesh exposes deafen');
  const room = await readFile(path.join(PUBLIC, 'js', 'room.js'), 'utf8');
  assert.match(room, /openParticipantMenu/, 'right-click menu for everyone');
  assert.match(room, /ctx-volume/, 'volume slider in the menu');
  assert.match(room, /hush:volumes:/, 'volumes persisted per room');
  assert.match(room, /soundboard:play/, 'room listens for board sounds');
});

test('ping v4 is lighter and fresher than v3', async () => {
  const ping = await readFile(path.join(PUBLIC, 'js', 'ping.js'), 'utf8');
  assert.match(ping, /PROBES = 2/, 'two probes, less self-contention');
  assert.match(ping, /TIMEOUT_MS = 1500/, 'shorter timeout');
  assert.match(ping, /document\.hidden/, 'paused when tab hidden');
  const app = await readFile(path.join(ROOT, 'src', 'app.js'), 'utf8');
  assert.match(app, /setNoDelay/, 'TCP_NODELAY on server sockets');
  assert.match(app, /pingInterval: 5000/, 'faster socket heartbeat');
});
