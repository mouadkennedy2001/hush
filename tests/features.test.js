import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHushServer } from '../src/app.js';
import { RoomManager } from '../src/rooms.js';
import { io as ioClient } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('dark design system has visible lines, glow, and typography tokens', async () => {
  const tokens = await readFile(path.join(PUBLIC, 'css', 'tokens.css'), 'utf8');
  assert.match(tokens, /--color-border-strong/, 'border-strong token');
  assert.match(tokens, /--glow-accent/, 'glow token');
  assert.match(tokens, /--font-mono/, 'mono font token');
  assert.match(tokens, /data-fontsize="large"/, 'text size preference');
  assert.match(tokens, /data-density="compact"/, 'compact density');

  const base = await readFile(path.join(PUBLIC, 'css', 'base.css'), 'utf8');
  assert.match(base, /radial-gradient/, 'dark ambience gradient');
  assert.match(base, /scrollbar-color/, 'dark scrollbars');

  const room = await readFile(path.join(PUBLIC, 'css', 'room.css'), 'utf8');
  assert.match(room, /\.ping-chart/, 'ping chart style');
  assert.match(room, /\.is-focus/, 'focus mode style');
  assert.match(room, /\.message-edit-input/, 'inline edit style');
});

test('settings module persists display preferences and volume', async () => {
  const settings = await readFile(path.join(PUBLIC, 'js', 'settings.js'), 'utf8');
  assert.match(settings, /hush:settings/, 'persisted key');
  assert.match(settings, /dataset\.fontsize/, 'applies font size');
  assert.match(settings, /data-setting-group/, 'syncs segmented controls');
  assert.match(settings, /data-volume-input/, 'volume control');
  assert.match(settings, /Notification\.requestPermission/, 'notification opt-in');

  const roomHtml = await readFile(path.join(PUBLIC, 'room.html'), 'utf8');
  assert.match(roomHtml, /data-setting-group="fontsize"/, 'text size control');
  assert.match(roomHtml, /data-setting-group="density"/, 'density control');
  assert.match(roomHtml, /data-ping-chart/, 'ping sparkline canvas');
  assert.match(roomHtml, /id="session-timer"/, 'session timer');
  assert.match(roomHtml, /id="focus-toggle"/, 'focus toggle');
});

test('ping sparkline and refresh are wired', async () => {
  const ping = await readFile(path.join(PUBLIC, 'js', 'ping.js'), 'utf8');
  assert.match(ping, /data-ping-chart/, 'chart rendering');
  assert.match(ping, /refreshPing/, 'manual refresh export');
});

test('RoomManager edits and deletes only the author message', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hush-edit-'));
  const rooms = new RoomManager({ dataDir: dir });
  await rooms.init();
  const room = await rooms.getOrCreate('ABC123');
  await rooms.addMessage(room, {
    id: 'm1',
    type: 'text',
    text: 'hello',
    attachment: null,
    authorId: 'alice',
    authorName: 'Alice',
    createdAt: Date.now(),
    reactions: {}
  });

  const edited = await rooms.editMessage(room, 'm1', 'alice', 'hello world');
  assert.equal(edited.text, 'hello world');
  assert.equal(await rooms.editMessage(room, 'm1', 'bob', 'hacked'), null);
  assert.equal(await rooms.deleteMessage(room, 'm1', 'bob'), false);
  assert.equal(await rooms.deleteMessage(room, 'm1', 'alice'), true);
  assert.equal(room.messages.length, 0);
});

test('socket edit and delete sync to room members', async () => {
  const hush = await createHushServer({ port: 0, host: '127.0.0.1' });
  const address = await hush.start();
  const url = `http://127.0.0.1:${address.port}`;
  const alice = ioClient(url, { transports: ['websocket'] });
  const bob = ioClient(url, { transports: ['websocket'] });
  const wait = (socket, event, timeout = 5000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout ${event}`)), timeout);
      socket.once(event, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  try {
    await onceConnect(alice);
    await onceConnect(bob);
    const joinA = emitAck(alice, 'room:join', { code: 'EDIT01', name: 'Alice' });
    const joinB = emitAck(bob, 'room:join', { code: 'EDIT01', name: 'Bob' });
    await Promise.all([joinA, joinB]);

    const messagePromise = wait(bob, 'chat:message');
    await emitAck(alice, 'chat:send', { text: 'original', attachment: null });
    const message = await messagePromise;

    const editedPromise = wait(bob, 'chat:edited');
    await emitAck(alice, 'chat:edit', { messageId: message.id, text: 'edited text' });
    const edited = await editedPromise;
    assert.equal(edited.text, 'edited text');

    // Bob cannot edit Alice's message.
    const denied = await emitAck(bob, 'chat:edit', { messageId: message.id, text: 'nope' });
    assert.equal(denied.ok, false);

    const deletedPromise = wait(bob, 'chat:deleted');
    await emitAck(alice, 'chat:delete', { messageId: message.id });
    const deleted = await deletedPromise;
    assert.equal(deleted.messageId, message.id);
  } finally {
    alice.disconnect();
    bob.disconnect();
    await hush.stop();
  }
});

function onceConnect(socket) {
  return socket.connected
    ? Promise.resolve()
    : new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (response) => resolve(response));
    setTimeout(() => reject(new Error(`ack timeout ${event}`)), 5000);
  });
}
