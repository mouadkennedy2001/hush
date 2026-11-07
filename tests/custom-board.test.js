import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHushServer } from '../src/app.js';
import { CUSTOM_EMOJI_IDS } from '../src/constants.js';
import { io as ioClient } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('custom emoji folder has an SVG per id and no unicode board emoji', async () => {
  for (const id of CUSTOM_EMOJI_IDS) {
    const file = path.join(PUBLIC, 'emoji', `${id}.svg`);
    await access(file);
    const svg = await readFile(file, 'utf8');
    assert.match(svg, /<svg/, `${id}.svg is an svg`);
  }
  const board = await readFile(path.join(PUBLIC, 'js', 'soundboard.js'), 'utf8');
  assert.match(board, /emojiId/, 'board uses custom emoji ids');
  assert.doesNotMatch(board, /emoji: '[^']*[\u{1F300}-\u{1FAFF}]/u, 'no unicode emoji on the board');
  const emojiModule = await readFile(path.join(PUBLIC, 'js', 'emoji.js'), 'utf8');
  assert.match(emojiModule, /\/emoji\//, 'emoji module points at public/emoji');
});

async function makeServer() {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hush-cboard-'));
  const hush = await createHushServer({ port: 0, host: '127.0.0.1', dataDir: path.join(dir, 'data'), uploadsDir: path.join(dir, 'uploads') });
  const address = await hush.start();
  return { hush, url: `http://127.0.0.1:${address.port}`, dir, fs, path };
}

const onceConnect = (s) => s.connected ? Promise.resolve() : new Promise((r, j) => { s.once('connect', r); s.once('connect_error', j); });
const ack = (s, ev, p) => new Promise((resolve) => s.emit(ev, p, (r) => resolve(r)));

function wavBytes() {
  // Minimal valid-ish WAV body (44-byte header + tone frames). Server only
  // checks extension/mime and size, so content shape is flexible.
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + 8000, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(8000, 24); header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32); header.writeUInt16LE(8, 34); header.write('data', 36);
  header.writeUInt32LE(8000, 40);
  return Buffer.concat([header, Buffer.alloc(8000, 128)]);
}

test('custom sound uploads to a room, relays, and deletes when last person leaves', async () => {
  const { hush, url, dir, fs } = await makeServer();
  const code = `CBD${String(Date.now()).slice(-3)}`;
  const alice = ioClient(url, { transports: ['websocket'] });
  const bob = ioClient(url, { transports: ['websocket'] });
  try {
    await Promise.all([onceConnect(alice), onceConnect(bob)]);
    const ja = await ack(alice, 'room:join', { code, name: 'Host', deviceId: 'device-cb-1' });
    const jb = await ack(bob, 'room:join', { code, name: 'Bob', deviceId: 'device-cb-2' });
    assert.equal(ja.ok, true); assert.equal(jb.ok, true);

    // Upload a custom WAV for this room only.
    const form = new FormData();
    form.append('file', new Blob([wavBytes()], { type: 'audio/wav' }), 'moo.wav');
    form.append('name', 'Moo');
    form.append('emojiId', 'cat');
    form.append('addedById', ja.self.id);
    form.append('addedBy', 'Host');
    const res = await fetch(`${url}/api/rooms/${code}/soundboard`, { method: 'POST', body: form });
    assert.equal(res.status, 201);
    const { sound } = await res.json();
    assert.ok(sound.url.startsWith(`/uploads/${code}/board/`));
    assert.equal(sound.emojiId, 'cat');
    // File exists on disk under the room's board folder.
    const file = path.join(dir, 'uploads', code, 'board', path.basename(sound.url));
    const stat = await fs.stat(file);
    assert.ok(stat.size > 100);

    // Bob (joining after upload is covered by join payload; here check relay).
    const heard = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('custom relay timeout')), 4000);
      bob.once('soundboard:play', (p) => { clearTimeout(t); resolve(p); });
    });
    const sent = await ack(alice, 'soundboard:play', { id: sound.id });
    assert.equal(sent.ok, true);
    const payload = await heard;
    assert.equal(payload.custom, true);
    assert.equal(payload.url, sound.url);

    // Bob can also play it; an unknown id is rejected.
    const bad = await ack(bob, 'soundboard:play', { id: '00000000-0000-0000-0000-000000000000' });
    assert.equal(bad.ok, false);

    // Non-audio upload is rejected.
    const badForm = new FormData();
    badForm.append('file', new Blob(['hello'], { type: 'text/plain' }), 'note.txt');
    const badRes = await fetch(`${url}/api/rooms/${code}/soundboard`, { method: 'POST', body: badForm });
    assert.equal(badRes.status, 415);

    // When the LAST person leaves, the custom board is deleted completely.
    alice.disconnect();
    bob.disconnect();
    await new Promise((r) => setTimeout(r, 800));
    await assert.rejects(() => fs.stat(file), 'custom sound file must be deleted after last leave');
    const boardDir = path.join(dir, 'uploads', code, 'board');
    await assert.rejects(() => fs.stat(boardDir), 'board folder must be gone');
  } finally {
    alice.disconnect(); bob.disconnect();
    await hush.stop();
  }
});

test('custom sounds do not leak into the next session of the same room code', async () => {
  const { hush, url } = await makeServer();
  const code = `CBD${String(Date.now()).slice(-3)}`;
  const s1 = ioClient(url, { transports: ['websocket'] });
  try {
    await onceConnect(s1);
    await ack(s1, 'room:join', { code, name: 'Solo', deviceId: 'device-cb-solo' });
    const form = new FormData();
    form.append('file', new Blob([wavBytes()], { type: 'audio/wav' }), 'solo.wav');
    form.append('name', 'Solo');
    form.append('emojiId', 'star');
    const res = await fetch(`${url}/api/rooms/${code}/soundboard`, { method: 'POST', body: form });
    assert.equal(res.status, 201);
    s1.disconnect();
    await new Promise((r) => setTimeout(r, 800));

    const s2 = ioClient(url, { transports: ['websocket'] });
    try {
      await onceConnect(s2);
      const joined = await ack(s2, 'room:join', { code, name: 'Next', deviceId: 'device-cb-next' });
      assert.equal(joined.ok, true);
      assert.deepEqual(joined.room.customSounds, [], 'custom board must start empty after last leave');
    } finally { s2.disconnect(); }
  } finally {
    s1.disconnect();
    await hush.stop();
  }
});

test('host can delete a custom sound and clear the whole board', async () => {
  const { hush, url } = await makeServer();
  const code = `CBD${String(Date.now()).slice(-3)}`;
  const alice = ioClient(url, { transports: ['websocket'] });
  const bob = ioClient(url, { transports: ['websocket'] });
  try {
    await Promise.all([onceConnect(alice), onceConnect(bob)]);
    const ja = await ack(alice, 'room:join', { code, name: 'Host', deviceId: 'device-cb-h1' });
    await ack(bob, 'room:join', { code, name: 'Bob', deviceId: 'device-cb-h2' });
    const form = new FormData();
    form.append('file', new Blob([wavBytes()], { type: 'audio/wav' }), 'x.wav');
    form.append('name', 'X'); form.append('emojiId', 'fire');
    form.append('addedById', ja.self.id); form.append('addedBy', 'Host');
    const { sound } = await (await fetch(`${url}/api/rooms/${code}/soundboard`, { method: 'POST', body: form })).json();

    // Bob cannot delete host's sound.
    const denied = await ack(bob, 'soundboard:deleteCustom', { id: sound.id });
    assert.equal(denied.ok, false);
    // Host can.
    const ok = await ack(alice, 'soundboard:deleteCustom', { id: sound.id });
    assert.equal(ok.ok, true);

    // Re-add then clear all as host.
    const form2 = new FormData();
    form2.append('file', new Blob([wavBytes()], { type: 'audio/wav' }), 'y.wav');
    form2.append('name', 'Y'); form2.append('emojiId', 'heart'); form2.append('addedById', ja.self.id);
    await fetch(`${url}/api/rooms/${code}/soundboard`, { method: 'POST', body: form2 });
    const cleared = await ack(alice, 'soundboard:clearCustom', {});
    assert.equal(cleared.ok, true);
  } finally {
    alice.disconnect(); bob.disconnect();
    await hush.stop();
  }
});
