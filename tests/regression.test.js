import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHushServer } from '../src/app.js';
import { io as ioClient } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('settings observer cannot retrigger itself (join-gate freeze regression)', async () => {
  const settings = await readFile(path.join(PUBLIC, 'js', 'settings.js'), 'utf8');
  // Must NOT observe the whole body subtree.
  assert.doesNotMatch(settings, /observer\.observe\(document\.body/, 'observer must not watch document.body');
  // Volume label write must be guarded by a change check.
  assert.match(settings, /output\.textContent !== label/, 'volume label write is change-guarded');
  // Observer is scoped to the remote-audio container only.
  assert.match(settings, /querySelector\('#remote-audio'\)/, 'observer scoped to remote audio');
});

test('room boot guards storage and never leaves the gate dead', async () => {
  const room = await readFile(path.join(PUBLIC, 'js', 'room.js'), 'utf8');
  assert.match(room, /try \{\s*savedName = localStorage\.getItem/, 'saved name is guarded');
  assert.match(room, /Name persistence is optional/, 'join never fails on storage');
  assert.match(room, /Hush room init failed/, 'init failure surfaces instead of hanging');

  const html = await readFile(path.join(PUBLIC, 'room.html'), 'utf8');
  // Gate is visible by default (no hidden attribute on the overlay).
  assert.doesNotMatch(html, /<div class="join-gate" id="join-gate" hidden/, 'gate must not start hidden');
  assert.match(html, /<noscript>/, 'noscript fallback present');
});

test('theme supports automatic (system) mode', async () => {
  const theme = await readFile(path.join(PUBLIC, 'js', 'theme.js'), 'utf8');
  assert.match(theme, /'auto'/, 'auto mode exists');
  assert.match(theme, /prefers-color-scheme: dark/, 'auto follows system');
  assert.match(theme, /addEventListener\('change'/, 'auto reacts to OS changes');

  const boot = await readFile(path.join(PUBLIC, 'js', 'lang-boot.js'), 'utf8');
  assert.match(boot, /thememode/, 'early boot records mode');
});

test('pinned messages sync between clients', async () => {
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
    await Promise.all([
      emitAck(alice, 'room:join', { code: 'PIN001', name: 'Alice' }),
      emitAck(bob, 'room:join', { code: 'PIN001', name: 'Bob' })
    ]);

    const messagePromise = wait(bob, 'chat:message');
    await emitAck(alice, 'chat:send', { text: 'please read this', attachment: null });
    const message = await messagePromise;

    const pinnedPromise = wait(bob, 'chat:pinned');
    await emitAck(alice, 'chat:pin', { messageId: message.id });
    const pinned = await pinnedPromise;
    assert.equal(pinned.pinnedMessageId, message.id);

    const unpinnedPromise = wait(bob, 'chat:pinned');
    await emitAck(alice, 'chat:pin', { messageId: '' });
    const unpinned = await unpinnedPromise;
    assert.equal(unpinned.pinnedMessageId, null);

    // Pinning a missing message is rejected, not broadcast.
    const denied = await emitAck(alice, 'chat:pin', { messageId: 'missing' });
    assert.equal(denied.ok, false);
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
