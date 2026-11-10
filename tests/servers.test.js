import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHushServer } from '../src/app.js';
import { io as ioClient } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

const onceConnect = (s) => s.connected ? Promise.resolve() : new Promise((r, j) => { s.once('connect', r); s.once('connect_error', j); });
const ack = (s, ev, p) => new Promise((resolve) => s.emit(ev, p, resolve));

test('servers are separate from rooms: permanent, own chat, invite link', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hush-srv-'));
  const dataDir = path.join(dir, 'data');
  const uploadsDir = path.join(dir, 'uploads');

  let hush = await createHushServer({ port: 0, host: '127.0.0.1', dataDir, uploadsDir });
  let address = await hush.start();
  let url = `http://127.0.0.1:${address.port}`;
  let server;
  try {
    const created = await fetch(`${url}/api/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Friends', ownerName: 'Ahmed', ownerDeviceId: 'device-server-1', iconEmojiId: 'robot' })
    });
    assert.equal(created.status, 201);
    server = (await created.json()).server;
    assert.ok(server.id.startsWith('srv_'));
    assert.ok(typeof server.inviteCode === 'string' && server.inviteCode.length === 10, 'invite is 10-char crypto code (A5)');
    assert.equal(server.channels.length, 2);
    // Channels carry NO room code — separate systems.
    for (const ch of server.channels) {
      assert.equal('code' in ch, false, 'server channel must not be a room');
    }

    // Non-member without invite cannot join
    const blocked = await fetch(`${url}/api/servers/${server.id}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'device-nomember1', name: 'Bob' })
    });
    assert.equal(blocked.status, 403);

    // Invite code lookup + join with invite
    const found = await fetch(`${url}/api/servers/invite/${server.inviteCode}`).then((r) => r.json());
    assert.equal(found.server.id, server.id);
    const joinedBob = await fetch(`${url}/api/servers/${server.id}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'device-nomember1', name: 'Bob', inviteCode: server.inviteCode })
    });
    assert.equal(joinedBob.status, 200);

    // Server chat over sockets (independent from room chat)
    const alice = ioClient(url, { transports: ['websocket'], forceNew: true });
    const bob = ioClient(url, { transports: ['websocket'], forceNew: true });
    try {
      await Promise.all([onceConnect(alice), onceConnect(bob)]);
      const ja = await ack(alice, 'server:join', { serverId: server.id, name: 'Ahmed', deviceId: 'device-server-1' });
      assert.equal(ja.ok, true);
      assert.equal(ja.server.id, server.id);
      const jb = await ack(bob, 'server:join', { serverId: server.id, name: 'Bob', deviceId: 'device-nomember1', inviteCode: server.inviteCode });
      assert.equal(jb.ok, true);
      const textChannel = ja.server.channels.find((c) => c.type === 'text');
      const heard = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server chat relay timeout')), 4000);
        bob.once('server:chat:message', (m) => { clearTimeout(timer); resolve(m); });
      });
      const sent = await ack(alice, 'server:chat:send', { channelId: textChannel.id, text: 'hello server', attachment: null });
      assert.equal(sent.ok, true);
      const message = await heard;
      assert.equal(message.text, 'hello server');
      assert.equal(message.channelId, textChannel.id);
      // Edit + delete own message
      const edited = await ack(alice, 'server:chat:edit', { channelId: textChannel.id, messageId: message.id, text: 'edited srv' });
      assert.equal(edited.ok, true);
      const denied = await ack(bob, 'server:chat:edit', { channelId: textChannel.id, messageId: message.id, text: 'hacked' });
      assert.equal(denied.ok, false);

      // N3/A14: member can NO LONGER add a channel (owner-only policy).
      const addedAsMember = await fetch(`${url}/api/servers/${server.id}/channels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'random', type: 'text', deviceId: 'device-nomember1' })
      });
      assert.equal(addedAsMember.status, 403, 'member must not add channels (owner-only)');
      // Owner CAN add a channel (REST), owner regenerates invite
      const added = await fetch(`${url}/api/servers/${server.id}/channels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'random', type: 'text', deviceId: 'device-server-1' })
      });
      assert.equal(added.status, 201);
      const regen = await fetch(`${url}/api/servers/${server.id}/regenerate-invite`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: 'device-server-1' })
      });
      assert.equal(regen.status, 200);
      const regenerated = (await regen.json()).server;
      assert.notEqual(regenerated.inviteCode, server.inviteCode);
      server.inviteCode = regenerated.inviteCode;
    } finally {
      alice.disconnect(); bob.disconnect();
    }
  } finally {
    await hush.stop();
  }

  // Restart on the same data dir: server + channel chat must survive.
  hush = await createHushServer({ port: 0, host: '127.0.0.1', dataDir, uploadsDir });
  address = await hush.start();
  url = `http://127.0.0.1:${address.port}`;
  try {
    const list = await fetch(`${url}/api/servers?deviceId=device-server-1`).then((r) => r.json());
    assert.equal(list.servers.length, 1);
    assert.equal(list.servers[0].channels.length, 3);
    const socket = ioClient(url, { transports: ['websocket'], forceNew: true });
    try {
      await onceConnect(socket);
      const joined = await ack(socket, 'server:join', { serverId: server.id, name: 'Ahmed', deviceId: 'device-server-1' });
      assert.equal(joined.ok, true);
      assert.ok(joined.messages.some((m) => m.text === 'edited srv'), 'server chat history persists across restart');
    } finally { socket.disconnect(); }
  } finally {
    await hush.stop();
  }
});

test('rooms and servers are separate pages/systems', async () => {
  const roomHtml = await readFile(path.join(PUBLIC, 'room.html'), 'utf8');
  assert.doesNotMatch(roomHtml, /id="server-panel"/, 'room page must not contain the server panel');
  assert.doesNotMatch(roomHtml, /id="server-channel-list"/, 'room page has no server channels');

  const serverHtml = await readFile(path.join(PUBLIC, 'server.html'), 'utf8');
  assert.match(serverHtml, /id="text-channels"/, 'server text channels');
  assert.match(serverHtml, /id="voice-channels"/, 'server voice channels');
  assert.match(serverHtml, /id="invite-copy"/, 'server invite copy button');
  assert.match(serverHtml, /id="image-lightbox"/, 'server lightbox');
  assert.match(serverHtml, /id="soundboard-panel"/, 'server soundboard');

  const serverJs = await readFile(path.join(PUBLIC, 'js', 'server.js'), 'utf8');
  assert.match(serverJs, /server:join/, 'server realtime join');
  assert.match(serverJs, /server:chat:send/, 'server chat send');
  assert.match(serverJs, /handlePasteImage/, 'server paste handler');
  assert.match(serverJs, /openImageLightbox/, 'server lightbox');

  const landing = await readFile(path.join(PUBLIC, 'index.html'), 'utf8');
  assert.match(landing, /id="rooms"/, 'rooms section separate');
  assert.match(landing, /id="servers"/, 'servers section separate');
  assert.match(landing, /id="invite-form"/, 'join with invite code form');
  assert.match(landing, /id="server-dialog"/, 'create-server dialog');

  const app = await readFile(path.join(ROOT, 'src', 'app.js'), 'utf8');
  assert.match(app, /\/s\/:id/, 'server page route');
  assert.match(app, /api\/servers\/invite/, 'invite lookup route');
  assert.doesNotMatch(app, /api\/servers\/by-code/, 'old room-coupled route removed');

  const css = await readFile(path.join(PUBLIC, 'css', 'server.css'), 'utf8');
  assert.match(css, /flex: none/, 'icons never overlap');
  // v13.2: compact board — category grids own the button columns (56px).
  const roomCss = await readFile(path.join(PUBLIC, 'css', 'room.css'), 'utf8');
  assert.match(roomCss, /minmax\(56px/, 'soundboard grid does not overlap');
  assert.match(roomCss, /max-height: 42vh/, 'soundboard panel is compact and scrolls');
});

test('server desktop mention notifications use the shared opt-in setting', async () => {
  const [serverHtml, serverJs] = await Promise.all([
    readFile(path.join(PUBLIC, 'server.html'), 'utf8'),
    readFile(path.join(PUBLIC, 'js', 'server.js'), 'utf8')
  ]);
  assert.match(serverHtml, /data-notifications-toggle/, 'server exposes notification permission control');
  assert.match(serverJs, /initSettings\(\)/, 'server initializes the shared notification preference');
  assert.match(serverJs, /maybeNotifyMention\(message\);\s*if \(message\.channelId !== state\.channelId\)/,
    'mentions in other channels notify while the user is away');
  assert.match(serverJs, /Notification\.permission !== 'granted'/, 'desktop permission is respected');
});
