import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHushServer } from '../src/app.js';
import { SOUNDBOARD_IDS, UI_SOUND_IDS } from '../src/constants.js';
import { cleanIconUrl, normalizeServerCustomSound } from '../src/servers.js';
import { io as ioClient } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('v13: Forge pack ships 87 real WAVs, every board id has a file + custom emoji', async () => {
  assert.equal(SOUNDBOARD_IDS.length, 87);
  for (const id of SOUNDBOARD_IDS) {
    const buf = await readFile(path.join(PUBLIC, 'sounds', `${id}.wav`));
    assert.ok(buf.length > 1000, `${id}.wav too small`);
    assert.equal(buf.subarray(0, 4).toString(), 'RIFF', `${id}.wav not a WAV`);
  }
  const { SOUNDBOARD_SOUNDS } = await import('../public/js/soundboard.js');
  const { CUSTOM_EMOJIS } = await import('../public/js/emoji.js');
  const emojiIds = new Set(CUSTOM_EMOJIS.map((e) => e.id));
  assert.equal(SOUNDBOARD_SOUNDS.length, 87);
  for (const s of SOUNDBOARD_SOUNDS) assert.ok(emojiIds.has(s.emojiId), `${s.id} emoji ${s.emojiId} missing`);
  assert.ok(UI_SOUND_IDS.every((id) => SOUNDBOARD_IDS.includes(id)), 'UI sounds are a subset of the board');
});

test('v13: white-tile + presence fixes are wired (CSS + JS)', async () => {
  const roomCss = await readFile(path.join(PUBLIC, 'css', 'room.css'), 'utf8');
  assert.match(roomCss, /--color-video-bg/, 'fixed dark video background');
  assert.doesNotMatch(roomCss, /\.tile-video \{[^}]*var\(--color-ink\)/, 'video bg must not use --color-ink (white in dark theme)');
  assert.match(roomCss, /data-state="online"[^}]*--color-online/, 'online dot is green');
  assert.match(roomCss, /data-state="offline"[^}]*--color-offline/, 'offline dot is red');
  assert.match(roomCss, /\.presence-dot/, 'room people presence dots');
  assert.match(roomCss, /\.screen-stop-btn/, 'Discord-style stop-watching button');

  const media = await readFile(path.join(PUBLIC, 'js', 'room', 'media.js'), 'utf8');
  assert.match(media, /streamHasVideo/, 'muted placeholder tracks are not video');
  assert.match(media, /track\.muted/, 'frames checked via muted');

  const roomJs = await readFile(path.join(PUBLIC, 'js', 'room.js'), 'utf8');
  assert.match(roomJs, /presence-dot/, 'room renders presence dots');
  assert.match(roomJs, /hiddenScreenId/, 'stop-watching state');
  assert.match(roomJs, /soundboard-store/, 'personal IndexedDB board in rooms');

  const serverJs = await readFile(path.join(PUBLIC, 'js', 'server.js'), 'utf8');
  assert.match(serverJs, /onlineMemberIds/, 'server members match presence by memberId');
  assert.match(serverJs, /cameraOn/, 'server tiles require cameraOn');
  assert.match(serverJs, /deafen/, 'deafen in server voice');
  assert.match(serverJs, /soundboard-store/, 'personal IndexedDB board in servers');

  const serverCss = await readFile(path.join(PUBLIC, 'css', 'server.css'), 'utf8');
  assert.match(serverCss, /--color-offline/, 'server offline dot is red');

  const base = await readFile(path.join(PUBLIC, 'css', 'base.css'), 'utf8');
  assert.match(base, /ping-badge\[data-quality="offline"\][\s\S]*?--color-offline/, 'ping offline dot is red');
});

test('v13: server icon + custom sound validation (no arbitrary URLs)', () => {
  assert.equal(cleanIconUrl('/uploads/server-srv_abc123/icon.png', 'srv_abc123'), '/uploads/server-srv_abc123/icon.png');
  assert.equal(cleanIconUrl('https://evil.test/x.png', 'srv_abc123'), '');
  assert.equal(cleanIconUrl('/uploads/server-srv_abc123/icon.svg', 'srv_abc123'), '');
  assert.equal(cleanIconUrl('/uploads/server-srv_other/icon.png', 'srv_abc123'), '');
  const snd = normalizeServerCustomSound({
    id: 'x', name: 'Mine', emojiId: 'star',
    url: '/uploads/server-srv_abc123/board/a.mp3', imageUrl: '/uploads/server-srv_abc123/board/c.png',
    size: 100, mime: 'audio/mpeg'
  }, 'srv_abc123');
  assert.equal(snd.imageUrl, '/uploads/server-srv_abc123/board/c.png');
  assert.equal(normalizeServerCustomSound({ id: 'x', url: 'https://evil/a.mp3', size: 1 }, 'srv_abc123'), null);
});

test('v13: server board upload + icon upload over HTTP (owner rules)', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hush-v13-'));
  const hush = await createHushServer({ port: 0, host: '127.0.0.1', dataDir: path.join(dir, 'data'), uploadsDir: path.join(dir, 'uploads') });
  const address = await hush.start();
  const url = `http://127.0.0.1:${address.port}`;
  const deviceId = 'device-v13-owner-1';
  try {
    const created = await (await fetch(`${url}/api/servers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'V13', ownerName: 'Owner', ownerDeviceId: deviceId })
    })).json();
    const serverId = created.server.id;
    const token = created.sessionToken;

    // Icon upload by owner works and is served from /uploads.
    const png = await readFile(path.join(ROOT, 'botton', 'brave_yxRxXbI8S5.png'));
    const iconForm = new FormData();
    iconForm.append('file', new Blob([png], { type: 'image/png' }), 'icon.png');
    const iconRes = await fetch(`${url}/api/servers/${serverId}/icon?deviceId=${deviceId}`, {
      method: 'POST', body: iconForm, headers: token ? { 'X-Session-Token': token } : {}
    });
    assert.equal(iconRes.status, 201);
    const iconData = await iconRes.json();
    assert.equal(iconData.server.iconUrl, `/uploads/server-${serverId}/icon.png`);
    const served = await fetch(`${url}${iconData.server.iconUrl}`);
    assert.equal(served.status, 200);

    // Non-owner icon upload is refused.
    const strangerJoin = await fetch(`${url}/api/servers/${serverId}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'device-v13-stranger', name: 'Stranger', inviteCode: created.server.inviteCode })
    }).then((response) => response.json());
    const badIcon = new FormData();
    badIcon.append('file', new Blob([png], { type: 'image/png' }), 'icon.png');
    const badRes = await fetch(`${url}/api/servers/${serverId}/icon?deviceId=device-v13-stranger`, {
      method: 'POST', body: badIcon,
      headers: { 'X-Session-Token': strangerJoin.sessionToken }
    });
    assert.equal(badRes.status, 403);

    // Server custom sound upload (member) + relay shape.
    const wav = Buffer.concat([Buffer.from('RIFFxxxxWAVEfmt '), Buffer.alloc(2000, 1)]);
    const sndForm = new FormData();
    sndForm.append('file', new Blob([wav], { type: 'audio/wav' }), 'mine.wav');
    sndForm.append('name', 'Mine');
    sndForm.append('emojiId', 'star');
    const sndRes = await fetch(`${url}/api/servers/${serverId}/soundboard?deviceId=${deviceId}`, {
      method: 'POST', body: sndForm, headers: token ? { 'X-Session-Token': token } : {}
    });
    assert.equal(sndRes.status, 201);
    const { sound } = await sndRes.json();
    assert.ok(sound.url.startsWith(`/uploads/server-${serverId}/board/`));

    // Presence carries memberId (not deviceId) so member dots work.
    const client = ioClient(url, { transports: ['websocket'] });
    const onceConnect = client.connected ? Promise.resolve() : new Promise((r, j) => { client.once('connect', r); client.once('connect_error', j); });
    await onceConnect;
    const ack = (ev, p) => new Promise((resolve) => client.emit(ev, p, (r) => resolve(r)));
    const joined = await ack('server:join', { serverId, name: 'Owner', deviceId, inviteCode: created.server.inviteCode });
    assert.ok(joined.ok, 'server join ok');
    assert.ok(Array.isArray(joined.membersOnline));
    const mine = joined.membersOnline.find((p) => p.id === joined.self.id);
    assert.ok(mine?.memberId, 'presence carries memberId');
    assert.ok(mine.deviceId, 'private ack still carries deviceId for self');
    client.disconnect();
  } finally {
    await hush.stop();
  }
});

test('v13: landing + server settings expose the image inputs', async () => {
  const index = await readFile(path.join(PUBLIC, 'index.html'), 'utf8');
  assert.match(index, /id="server-image-input"/, 'image at server creation');
  const landing = await readFile(path.join(PUBLIC, 'js', 'landing.js'), 'utf8');
  assert.match(landing, /uploadServerIcon/, 'creation uploads the image');
  const serverHtml = await readFile(path.join(PUBLIC, 'server.html'), 'utf8');
  assert.match(serverHtml, /id="server-settings"/, 'owner settings form');
  assert.match(serverHtml, /id="deafen-btn"/, 'deafen in server voice');
  assert.match(serverHtml, /id="server-screen-stop-watching"/, 'stop watching in servers');
  const roomHtml = await readFile(path.join(PUBLIC, 'room.html'), 'utf8');
  assert.match(roomHtml, /id="screen-stop-watching"/, 'stop watching in rooms');
  assert.match(roomHtml, /id="soundboard-my-grid"/, 'personal board in rooms');
  await access(path.join(PUBLIC, 'js', 'soundboard-store.js'));
});
