import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { io as connectClient } from 'socket.io-client';

import { createHushServer } from '../src/app.js';
import {
  RoomManager,
  cleanDeviceType,
  cleanMessageText,
  cleanName,
  cleanRoomName,
  cleanRoomPassword,
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

test('cleanRoomName strips tricks, collapses whitespace, and caps length', () => {
  assert.equal(cleanRoomName('  Friday\u200b Standup\t '), 'Friday Standup');
  assert.equal(cleanRoomName(''), '');
  assert.equal(cleanRoomName(null), '');
  assert.equal(cleanRoomName('x'.repeat(300)).length, 60);
});

test('cleanRoomPassword: empty = none, out-of-range = invalid, valid = trimmed', () => {
  assert.equal(cleanRoomPassword(''), null);
  assert.equal(cleanRoomPassword(null), null);
  assert.equal(cleanRoomPassword('abc'), undefined, 'too short');
  assert.equal(cleanRoomPassword('x'.repeat(200)), undefined, 'too long');
  assert.equal(cleanRoomPassword('  hunter2  '), 'hunter2');
  assert.equal(cleanRoomPassword('pa\u0000ss\rword'), 'password', 'control chars dropped');
});

test('cleanDeviceType whitelists phone/pc/tablet only', () => {
  assert.equal(cleanDeviceType('phone'), 'phone');
  assert.equal(cleanDeviceType('pc'), 'pc');
  assert.equal(cleanDeviceType('tablet'), 'tablet');
  assert.equal(cleanDeviceType('toaster'), '');
  assert.equal(cleanDeviceType(null), '');
  assert.equal(cleanDeviceType('<img src=x>'), '');
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

test('RoomManager names and passwords: hash-only storage, verify, remove', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hush-rooms-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const rooms = new RoomManager({ dataDir: dir });
  await rooms.init();
  const room = await rooms.getOrCreate('NAMED1');

  // Name: cleaned + persisted, empty stays untitled.
  assert.equal(await rooms.setRoomName(room, '  Friday  Standup '), 'Friday Standup');
  assert.equal(room.name, 'Friday Standup');
  assert.equal(await rooms.setRoomName(room, ''), '');

  // Password: only a scrypt salt+hash is stored, never the plaintext.
  assert.equal(rooms.hasPassword(room), false);
  await rooms.setPassword(room, 'hunter2');
  assert.equal(rooms.hasPassword(room), true);
  assert.notEqual(room.passwordHash, 'hunter2');
  assert.match(room.passwordHash, /^[0-9a-f]{128}$/);
  assert.match(room.passwordSalt, /^[0-9a-f]{32}$/);

  // Constant-work verify: right and wrong answers.
  assert.equal(await rooms.verifyPassword(room, 'hunter2'), true);
  assert.equal(await rooms.verifyPassword(room, 'hunter3'), false);
  assert.equal(await rooms.verifyPassword(room, ''), false);

  // Out-of-range values are rejected before anything is stored.
  await assert.rejects(() => rooms.setPassword(room, 'abc'), /invalid-room-password/);
  assert.equal(await rooms.verifyPassword(room, 'hunter2'), true, 'old password survives a rejected change');

  // Remove: room becomes open again, verify passes for anyone.
  await rooms.removePassword(room);
  assert.equal(rooms.hasPassword(room), false);
  assert.equal(await rooms.verifyPassword(room, 'hunter2'), true);

  // Setting empty is the same as removing.
  await rooms.setPassword(room, 'hunter2');
  await rooms.setPassword(room, '');
  assert.equal(rooms.hasPassword(room), false);

  // Persistence: a fresh manager over the same data dir keeps hash + name.
  await rooms.setPassword(room, 'persistence-check');
  await rooms.setRoomName(room, 'Saved name');
  const again = new RoomManager({ dataDir: dir });
  await again.init();
  const stored = await again.getOrCreate('NAMED1');
  assert.equal(stored.name, 'Saved name');
  assert.equal(again.hasPassword(stored), true);
  assert.equal(await again.verifyPassword(stored, 'persistence-check'), true);
  assert.equal(await again.verifyPassword(stored, 'wrong'), false);
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

function join(socket, code, name, extra = {}) {
  return new Promise((resolve, reject) => {
    socket.emit('room:join', { code, name, ...extra }, (response) => {
      if (response?.ok) resolve(response);
      else reject(new Error(response?.error || 'join-failed'));
    });
  });
}

// Raw variant: resolves the full ack (password-gate tests need error bodies).
function joinRaw(socket, code, name, extra = {}) {
  return new Promise((resolve) => {
    socket.emit('room:join', { code, name, ...extra }, (response) => resolve(response ?? {}));
  });
}

function emitAck(socket, event, payload = {}) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => resolve(response ?? {}));
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

test('room creation accepts an optional name and password over HTTP', async (t) => {
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

  const plain = await fetch(`${url}/api/rooms`, { method: 'POST' }).then((response) => response.json());
  assert.equal(plain.name, '');
  assert.equal(plain.hasPassword, false);

  const created = await fetch(`${url}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '  Friday Standup ', password: ' hunter2 ' })
  });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.name, 'Friday Standup', 'name is cleaned');
  assert.equal(body.hasPassword, true);

  const lookup = await fetch(`${url}/api/rooms/${body.code}`).then((response) => response.json());
  assert.equal(lookup.exists, true);
  assert.equal(lookup.name, 'Friday Standup');
  assert.equal(lookup.passwordRequired, true);

  const tooShort = await fetch(`${url}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'abc' })
  });
  assert.equal(tooShort.status, 400);
  assert.equal((await tooShort.json()).error, 'invalid-room-password');

  const tooLong = await fetch(`${url}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'x'.repeat(200) })
  });
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).error, 'invalid-room-password');
});

test('join gate: password-required vs wrong-password vs correct password', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hush-app-'));
  const hush = await createHushServer({
    dataDir: path.join(dir, 'data'),
    uploadsDir: path.join(dir, 'uploads'),
    log: { warn() {}, error() {} }
  });
  const address = await hush.start(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;

  const created = await fetch(`${url}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Standup', password: 'hunter2' })
  }).then((response) => response.json());
  const code = created.code;

  const client = connectClient(url, { transports: ['websocket'], forceNew: true });
  t.after(async () => {
    client.close();
    await hush.stop();
    await rm(dir, { recursive: true, force: true });
  });
  await once(client, 'connect');

  // Nothing sent: the UI needs to show the gate (keeps nothing typed).
  const noPassword = await joinRaw(client, code, 'Amira');
  assert.equal(noPassword.ok, false);
  assert.equal(noPassword.error, 'password-required');
  assert.equal(noPassword.passwordRequired, true);

  // Wrong value sent: the UI keeps the typed value for a retry.
  const wrong = await joinRaw(client, code, 'Amira', { password: 'letmein' });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.error, 'wrong-password');
  assert.equal(wrong.passwordRequired, true);

  // Right value: full join payload, host because first in.
  const good = await join(client, code, 'Amira', { password: 'hunter2' });
  assert.equal(good.room.hasPassword, true);
  assert.equal(good.room.name, 'Standup');
  assert.equal(good.isHost, true);
});

test('host renames the room and manages the password; non-hosts cannot', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hush-app-'));
  const hush = await createHushServer({
    dataDir: path.join(dir, 'data'),
    uploadsDir: path.join(dir, 'uploads'),
    log: { warn() {}, error() {} }
  });
  const address = await hush.start(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  const code = await hush.rooms.generateUniqueCode();

  const host = connectClient(url, { transports: ['websocket'], forceNew: true });
  const guest = connectClient(url, { transports: ['websocket'], forceNew: true });
  const latecomer = connectClient(url, { transports: ['websocket'], forceNew: true });

  t.after(async () => {
    host.close();
    guest.close();
    latecomer.close();
    await hush.stop();
    await rm(dir, { recursive: true, force: true });
  });

  await Promise.all([once(host, 'connect'), once(guest, 'connect'), once(latecomer, 'connect')]);
  await join(host, code, 'Amira');
  await join(guest, code, 'Jon');

  // Only the host may touch room settings.
  const guestRename = await emitAck(guest, 'room:rename', { name: 'Jon was here' });
  assert.equal(guestRename.ok, false);
  assert.equal(guestRename.error, 'not-admin');
  const guestPassword = await emitAck(guest, 'room:password', { password: 'nope1234' });
  assert.equal(guestPassword.ok, false);
  assert.equal(guestPassword.error, 'not-admin');

  // Rename: cleaned, acked, and broadcast to everyone instantly.
  const renamed = once(guest, 'room:renamed');
  const renameAck = await emitAck(host, 'room:rename', { name: '  New  Name ' });
  assert.equal(renameAck.ok, true);
  assert.equal(renameAck.name, 'New Name');
  const renameBroadcast = await renamed;
  assert.equal(renameBroadcast.name, 'New Name');
  assert.equal(renameBroadcast.by, 'Amira');

  // Password on: broadcast says protection changed, never the value itself.
  const protectedEvent = once(guest, 'room:password-changed');
  const setPasswordAck = await emitAck(host, 'room:password', { password: 'sekrit1' });
  assert.equal(setPasswordAck.ok, true);
  assert.equal(setPasswordAck.hasPassword, true);
  const protectedBroadcast = await protectedEvent;
  assert.equal(protectedBroadcast.hasPassword, true);
  assert.equal(protectedBroadcast.by, 'Amira');
  assert.equal('password' in protectedBroadcast, false, 'the value itself is never broadcast');

  // New joins follow the new rule; people inside stay inside.
  const blocked = await joinRaw(latecomer, code, 'Late');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'password-required');

  // Invalid new passwords are rejected without changing the room.
  const invalid = await emitAck(host, 'room:password', { password: 'abc' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, 'invalid-room-password');

  // Password off: broadcast again, and the latecomer walks right in.
  const openEvent = once(guest, 'room:password-changed');
  const removedAck = await emitAck(host, 'room:password', { password: '' });
  assert.equal(removedAck.ok, true);
  assert.equal(removedAck.hasPassword, false);
  const openBroadcast = await openEvent;
  assert.equal(openBroadcast.hasPassword, false);
  const lateJoin = await join(latecomer, code, 'Late');
  assert.equal(lateJoin.room.hasPassword, false);
  assert.equal(lateJoin.room.name, 'New Name');

  const lookup = await fetch(`${url}/api/rooms/${code}`).then((response) => response.json());
  assert.equal(lookup.name, 'New Name');
  assert.equal(lookup.passwordRequired, false);
});

test('device types ride along on participants and chat messages', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hush-app-'));
  const hush = await createHushServer({
    dataDir: path.join(dir, 'data'),
    uploadsDir: path.join(dir, 'uploads'),
    log: { warn() {}, error() {} }
  });
  const address = await hush.start(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  const code = await hush.rooms.generateUniqueCode();

  const phone = connectClient(url, { transports: ['websocket'], forceNew: true });
  const tablet = connectClient(url, { transports: ['websocket'], forceNew: true });
  const liar = connectClient(url, { transports: ['websocket'], forceNew: true });

  t.after(async () => {
    phone.close();
    tablet.close();
    liar.close();
    await hush.stop();
    await rm(dir, { recursive: true, force: true });
  });

  await Promise.all([once(phone, 'connect'), once(tablet, 'connect'), once(liar, 'connect')]);
  await join(phone, code, 'Amira', { deviceType: 'phone' });

  const peerJoined = once(phone, 'peer:joined');
  await join(tablet, code, 'Jon', { deviceType: 'tablet' });
  const joinedPeer = await peerJoined;
  assert.equal(joinedPeer.participant.deviceType, 'tablet');

  // Unknown values are whitelisted away (never trusted into broadcasts).
  const liarJoin = await join(liar, code, 'Sam', { deviceType: '<img src=x onerror=1>' });
  const sam = liarJoin.room.participants.find((participant) => participant.name === 'Sam');
  assert.equal(sam.deviceType, '');

  const incoming = once(phone, 'chat:message');
  await send(tablet, { text: 'hello from the tablet' });
  const message = await incoming;
  assert.equal(message.text, 'hello from the tablet');
  assert.equal(message.authorDeviceType, 'tablet', 'chat keeps the device icon for history');
});
