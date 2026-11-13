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
    const createdData = await created.json();
    server = createdData.server;
    const ownerToken = createdData.sessionToken;
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
    const bobToken = (await joinedBob.json()).sessionToken;

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
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': bobToken },
        body: JSON.stringify({ name: 'random', type: 'text', deviceId: 'device-nomember1' })
      });
      assert.equal(addedAsMember.status, 403, 'member must not add channels (owner-only)');
      const withoutToken = await fetch(`${url}/api/servers/${server.id}/channels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'unauthorized', type: 'text', deviceId: 'device-server-1' })
      });
      assert.equal(withoutToken.status, 401, 'deviceId alone is not a server session');
      // Owner CAN add a channel (REST), owner regenerates invite
      const added = await fetch(`${url}/api/servers/${server.id}/channels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': ownerToken },
        body: JSON.stringify({ name: 'random', type: 'text', deviceId: 'device-server-1' })
      });
      assert.equal(added.status, 201);
      const regen = await fetch(`${url}/api/servers/${server.id}/regenerate-invite`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': ownerToken },
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

test('Socket.IO rejects browser connections from a different Origin', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hush-origin-'));
  const hush = await createHushServer({
    port: 0,
    host: '127.0.0.1',
    dataDir: path.join(dir, 'data'),
    uploadsDir: path.join(dir, 'uploads')
  });
  const address = await hush.start();
  const url = `http://127.0.0.1:${address.port}`;
  const socket = ioClient(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: { Origin: 'https://attacker.example' }
  });
  try {
    await assert.rejects(onceConnect(socket));
  } finally {
    socket.disconnect();
    await hush.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
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

test('server roles enforce permission grants, hierarchy, and private member identifiers', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hush-role-'));
  const dataDir = path.join(dir, 'data');
  const uploadsDir = path.join(dir, 'uploads');
  let hush = await createHushServer({ port: 0, host: '127.0.0.1', dataDir, uploadsDir });
  let address = await hush.start();
  let url = `http://127.0.0.1:${address.port}`;
  const deviceIds = {
    owner: 'device-role-owner',
    host: 'device-role-host',
    sameHost: 'device-role-host-two',
    assistant: 'device-role-assist',
    custom: 'device-role-custom',
    member: 'device-role-member'
  };
  const request = (path, token, body, method = 'POST') => fetch(`${url}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  let server;
  let ownerToken;
  try {
    const created = await request('/api/servers', '', {
      name: 'Roles', ownerName: 'Owner', ownerDeviceId: deviceIds.owner
    });
    assert.equal(created.status, 201);
    ({ server, sessionToken: ownerToken } = await created.json());
    assert.deepEqual(server.roles.map((role) => role.id), ['host', 'assistant', 'member']);

    const tokens = {};
    for (const [key, name] of [['host', 'Host'], ['sameHost', 'Second host'], ['assistant', 'Assistant'], ['custom', 'Custom'], ['member', 'Member']]) {
      const joined = await fetch(`${url}/api/servers/${server.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceIds[key], name, inviteCode: server.inviteCode })
      });
      assert.equal(joined.status, 200);
      tokens[key] = (await joined.json()).sessionToken;
    }

    const ownerView = await fetch(`${url}/api/servers/${server.id}?deviceId=${deviceIds.owner}`).then((res) => res.json());
    const assign = async (key, roleIds) => {
      const member = ownerView.server.members.find((entry) => entry.deviceId === deviceIds[key]);
      assert.ok(member?.memberId);
      return request(`/api/servers/${server.id}/members/${member.memberId}/roles`, ownerToken, { roleIds }, 'PUT');
    };
    assert.equal((await assign('host', ['host'])).status, 200);
    assert.equal((await assign('sameHost', ['host'])).status, 200);
    assert.equal((await assign('assistant', ['assistant'])).status, 200);

    const roleCreated = await request(`/api/servers/${server.id}/roles`, ownerToken, {
      name: 'Channel manager',
      color: '#123456',
      permissions: ['manage_channels']
    });
    assert.equal(roleCreated.status, 201);
    const customRole = (await roleCreated.json()).role;
    assert.match(customRole.id, /^role_[a-f0-9]{32}$/);
    assert.equal((await assign('custom', [customRole.id])).status, 200);
    for (let index = 2; index <= 20; index += 1) {
      const response = await request(`/api/servers/${server.id}/roles`, ownerToken, {
        name: `Custom role ${index}`,
        color: '#123456',
        permissions: []
      });
      assert.equal(response.status, 201, `custom role ${index} should be accepted`);
    }

    const hostChannel = await request(`/api/servers/${server.id}/channels`, tokens.host, {
      name: 'host-channel', type: 'text', deviceId: deviceIds.host
    });
    assert.equal(hostChannel.status, 201, 'host can manage channels');
    assert.equal((await request(`/api/servers/${server.id}/roles`, tokens.host, {
      name: 'Unauthorized', color: '#123456', permissions: ['manage_channels']
    })).status, 403, 'host cannot manage roles');
    assert.equal((await request(`/api/servers/${server.id}`, tokens.host, undefined, 'DELETE')).status, 403,
      'host cannot delete the server');
    assert.equal((await request(`/api/servers/${server.id}/channels`, tokens.assistant, {
      name: 'assistant-channel', type: 'text', deviceId: deviceIds.assistant
    })).status, 403, 'assistant cannot manage channels');
    assert.equal((await request(`/api/servers/${server.id}/channels`, tokens.custom, {
      name: 'custom-channel', type: 'text', deviceId: deviceIds.custom
    })).status, 201, 'custom permissions grant channel management');
    assert.equal((await request(`/api/servers/${server.id}/channels`, tokens.member, {
      name: 'member-channel', type: 'text', deviceId: deviceIds.member
    })).status, 403, 'members have no administrative permissions by default');

    assert.equal((await request(`/api/servers/${server.id}/ban`, tokens.host, {
      targetDeviceId: deviceIds.sameHost, minutes: 60
    })).status, 403, 'hosts cannot moderate an equal-rank host');
    assert.equal((await request(`/api/servers/${server.id}/ban`, tokens.assistant, {
      targetDeviceId: deviceIds.member, minutes: 60
    })).status, 200, 'assistant can moderate a lower-rank member');

    const broadcast = hush.servers.broadcastSummary(hush.servers.get(server.id));
    assert.equal(broadcast.ownerDeviceId, null);
    assert.ok(broadcast.members.every((member) => !('deviceId' in member)), 'broadcasts redact every device id');
  } finally {
    await hush.stop();
  }

  hush = await createHushServer({ port: 0, host: '127.0.0.1', dataDir, uploadsDir });
  address = await hush.start();
  url = `http://127.0.0.1:${address.port}`;
  try {
    const restored = await fetch(`${url}/api/servers?deviceId=${deviceIds.owner}`).then((res) => res.json());
    assert.equal(restored.servers[0].roles.length, 23, 'all built-in and maximum custom roles persist');
    assert.ok(restored.servers[0].members.some((member) => member.roleIds.includes('host')), 'role assignments persist');
  } finally {
    await hush.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
