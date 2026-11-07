import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { io as connectClient } from 'socket.io-client';

import { createHushServer } from '../src/app.js';
import {
  RoomManager,
  cleanMessageText,
  cleanName,
  formatCode,
  generateCode,
  isValidCode,
  normalizeCode
} from '../src/rooms.js';

/* ---------------- Unit: room helpers ---------------- */

test('normalizeCode strips separators and uppercases', () => {
  assert.equal(normalizeCode(' k7m-2qx '), 'K7M2QX');
  assert.equal(normalizeCode(null), '');
});

test('isValidCode accepts 4–12 alphanumerics only', () => {
  assert.equal(isValidCode('ABCD'), true);
  assert.equal(isValidCode('ABC123'), true);
  assert.equal(isValidCode('AB'), false);
  assert.equal(isValidCode('ABCDABCDABCDA'), false);
  assert.equal(isValidCode('AB-CD'), false);
});

test('formatCode groups six-character codes', () => {
  assert.equal(formatCode('K7M2QX'), 'K7M-2QX');
  assert.equal(formatCode('ABCD'), 'ABCD');
});

test('generateCode uses the unambiguous alphabet', () => {
  for (let index = 0; index < 50; index += 1) {
    const code = generateCode();
    assert.equal(code.length, 6);
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  }
});

test('cleanName trims, collapses whitespace, and caps length', () => {
  assert.equal(cleanName('  Amira\tNoor  '), 'Amira Noor');
  assert.equal(cleanName(''), 'Guest');
  assert.equal(cleanName('x'.repeat(80)).length, 32);
});

test('cleanMessageText normalizes newlines and caps length', () => {
  assert.equal(cleanMessageText('a\r\nb\u0000c'), 'a\nbc');
  assert.equal(cleanMessageText('x'.repeat(3000)).length, 2000);
});

/* ---------------- Unit: RoomManager ---------------- */

test('RoomManager stores messages and toggles reactions', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hush-rooms-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const rooms = new RoomManager({ dataDir: dir, maxMessages: 2 });
  await rooms.init();

  const room = await rooms.getOrCreate('test1');
  await rooms.addMessage(room, { id: 'm1', text: 'one' });
  await rooms.addMessage(room, { id: 'm2', text: 'two' });
  await rooms.addMessage(room, { id: 'm3', text: 'three' });

  assert.deepEqual(room.messages.map((message) => message.id), ['m2', 'm3']);

  await rooms.toggleReaction(room, 'm3', 'thumbsup', 'peer-1');
  assert.deepEqual(room.messages[1].reactions['thumbsup'], ['peer-1']);

  await rooms.toggleReaction(room, 'm3', 'thumbsup', 'peer-2');
  assert.deepEqual(room.messages[1].reactions['thumbsup'], ['peer-1', 'peer-2']);

  await rooms.toggleReaction(room, 'm3', 'thumbsup', 'peer-1');
  assert.deepEqual(room.messages[1].reactions['thumbsup'], ['peer-2']);

  await rooms.toggleReaction(room, 'm3', 'thumbsup', 'peer-2');
  assert.equal(room.messages[1].reactions['thumbsup'], undefined);
});

test('RoomManager rejects invalid codes', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hush-rooms-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const rooms = new RoomManager({ dataDir: dir });
  await rooms.init();
  await assert.rejects(() => rooms.getOrCreate('no'), /invalid-room-code/);
});

/* ---------------- Integration: HTTP + Socket.IO ---------------- */

function once(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    const handler = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };

    socket.once(event, handler);
  });
}

function join(socket, code, name) {
  return new Promise((resolve, reject) => {
    socket.emit('room:join', { code, name }, (response) => {
      if (response?.ok) resolve(response);
      else reject(new Error(response?.error || 'join-failed'));
    });
  });
}

function send(socket, payload) {
  return new Promise((resolve, reject) => {
    socket.emit('chat:send', payload, (response) => {
      if (response?.ok) resolve(response);
      else reject(new Error(response?.error || 'send-failed'));
    });
  });
}

test('HTTP health and room creation respond', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hush-app-'));
  const hush = await createHushServer({
    dataDir: path.join(dir, 'data'),
    uploadsDir: path.join(dir, 'uploads'),
    log: { warn() {}, error() {} }
  });
  const address = await hush.start(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await hush.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const health = await fetch(`${url}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);

  const created = await fetch(`${url}/api/rooms`, { method: 'POST' }).then((response) =>
    response.json()
  );
  assert.match(created.code, /^[A-Z0-9]{6}$/);
  assert.equal(created.formatted, formatCode(created.code));

  const lookup = await fetch(`${url}/api/rooms/${created.code}`).then((response) =>
    response.json()
  );
  assert.equal(lookup.exists, true);
});

test('two clients join, chat, react, and update presence', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hush-app-'));
  const hush = await createHushServer({
    dataDir: path.join(dir, 'data'),
    uploadsDir: path.join(dir, 'uploads'),
    log: { warn() {}, error() {} }
  });
  const address = await hush.start(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  const code = await hush.rooms.generateUniqueCode();

  const clientA = connectClient(url, { transports: ['websocket'], forceNew: true });
  const clientB = connectClient(url, { transports: ['websocket'], forceNew: true });

  t.after(async () => {
    clientA.close();
    clientB.close();
    await hush.stop();
    await rm(dir, { recursive: true, force: true });
  });

  await Promise.all([once(clientA, 'connect'), once(clientB, 'connect')]);

  const [a, b] = await Promise.all([
    join(clientA, code, 'Amira'),
    join(clientB, code, 'Jon')
  ]);

  assert.equal(a.room.participants.length >= 1, true);
  assert.equal(a.self.name, 'Amira');
  assert.equal(b.self.name, 'Jon');

  const incoming = once(clientB, 'chat:message');
  await send(clientA, { text: 'Hello from Amira' });
  const message = await incoming;
  assert.equal(message.text, 'Hello from Amira');
  assert.equal(message.authorName, 'Amira');

  const reaction = once(clientA, 'chat:reaction');
  const reactionAck = await new Promise((resolve, reject) => {
    clientB.emit(
      'chat:react',
      { messageId: message.id, emoji: 'tada' },
      (response) => (response?.ok ? resolve(response) : reject(new Error(response?.error)))
    );
  });
  assert.deepEqual(reactionAck.reactions['tada'], [b.self.id]);
  const broadcast = await reaction;
  assert.equal(broadcast.messageId, message.id);

  const presence = once(clientB, 'peer:updated');
  clientA.emit('presence:update', {
    micOn: true,
    cameraOn: false,
    screenOn: false,
    handRaised: true
  });
  const update = await presence;
  assert.equal(update.id, a.self.id);
  assert.equal(update.handRaised, true);
});

test('uploads accept images and reject unsupported files', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hush-app-'));
  const hush = await createHushServer({
    dataDir: path.join(dir, 'data'),
    uploadsDir: path.join(dir, 'uploads'),
    log: { warn() {}, error() {} }
  });
  const address = await hush.start(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  const code = await hush.rooms.generateUniqueCode();
  await hush.rooms.getOrCreate(code);

  t.after(async () => {
    await hush.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZ7GAAAAAElFTkSuQmCC',
    'base64'
  );

  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'pixel.png');

  const uploaded = await fetch(`${url}/api/rooms/${code}/upload`, {
    method: 'POST',
    body: form
  });
  assert.equal(uploaded.status, 201);
  const attachment = await uploaded.json();
  assert.match(attachment.url, new RegExp(`^/uploads/${code}/[a-f0-9-]+\\.png$`));
  assert.equal(attachment.name, 'pixel.png');

  const downloaded = await fetch(url + attachment.url);
  assert.equal(downloaded.status, 200);

  const badForm = new FormData();
  badForm.append('file', new Blob(['nope'], { type: 'application/x-msdownload' }), 'bad.exe');
  const rejected = await fetch(`${url}/api/rooms/${code}/upload`, {
    method: 'POST',
    body: badForm
  });
  assert.equal(rejected.status, 415);
});

test('joining a full room is rejected', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hush-app-'));
  const hush = await createHushServer({
    dataDir: path.join(dir, 'data'),
    uploadsDir: path.join(dir, 'uploads'),
    log: { warn() {}, error() {} }
  });
  const address = await hush.start(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  const code = await hush.rooms.generateUniqueCode();

  const clients = Array.from({ length: 12 }, () =>
    connectClient(url, { transports: ['websocket'], forceNew: true })
  );

  t.after(async () => {
    for (const client of clients) client.close();
    await hush.stop();
    await rm(dir, { recursive: true, force: true });
  });

  await Promise.all(clients.map((client) => once(client, 'connect')));
  await Promise.all(
    clients.map((client, index) => join(client, code, `Guest ${index + 1}`))
  );

  const extra = connectClient(url, { transports: ['websocket'], forceNew: true });
  t.after(() => extra.close());
  await once(extra, 'connect');

  await assert.rejects(() => join(extra, code, 'Extra'), /room-full/);
});
