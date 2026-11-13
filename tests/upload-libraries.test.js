import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHushServer } from '../src/app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('emoji picker: fixed position, unified sizes, no overlap', async () => {
  const roomCss = await readFile(path.join(PUBLIC, 'css', 'room.css'), 'utf8');
  assert.match(roomCss, /\.emoji-menu \{\s*position: fixed;/, 'menu is fixed (not clipped by overflow:hidden)');
  assert.match(roomCss, /\.emoji-grid \{[^}]*grid-template-columns: repeat\(6/, 'grid lives on .emoji-grid');
  assert.doesNotMatch(roomCss, /\.emoji-menu \{\s*position: absolute;\s*inset-inline-start/, 'old absolute menu removed');
  // Sizes (v12.3, larger): base 32, message 28, emoji-only 48, chip 20.
  assert.match(roomCss, /\.custom-emoji \{[^}]*width: 32px;/);
  assert.match(roomCss, /\.message-emoji \{[^}]*width: 28px;/);
  assert.match(roomCss, /\.message\.is-emoji-only \.message-emoji \{[^}]*width: 48px;/);
  assert.match(roomCss, /\.reaction-chip \.custom-emoji \{[^}]*width: 20px;/);
  assert.match(roomCss, /\.emoji-choice \.custom-emoji \{[^}]*width: 38px;/, 'picker emoji 38px');

  const serverJs = await readFile(path.join(PUBLIC, 'js', 'server.js'), 'utf8');
  assert.match(serverJs, /positionEmojiMenu/);
  assert.ok(serverJs.includes('closeEmojiMenu()'), 'outside click closes emoji menu');
  const roomJs = await readFile(path.join(PUBLIC, 'js', 'room.js'), 'utf8');
  assert.match(roomJs, /rect\.right - menuW/, 'RTL-aware positioning');
  // No focus steal on open.
  assert.doesNotMatch(roomJs, /search\?\.focus\(\{ preventScroll: true \}\)/, 'focus stays in composer');
});

test('server upload: multipart channelId read after multer (was always 404)', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hush-upload-'));
  const hush = await createHushServer({ port: 0, host: '127.0.0.1', dataDir: path.join(dir, 'data'), uploadsDir: path.join(dir, 'uploads') });
  const address = await hush.start();
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const created = await fetch(`${url}/api/servers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'UploadTest', ownerName: 'A', ownerDeviceId: 'device-upload-1', iconEmojiId: 'star' })
    });
    const createdData = await created.json();
    const server = createdData.server;
    const token = createdData.sessionToken;
    const channel = server.channels.find((c) => c.type === 'text');
    const png = await readFile(path.join(ROOT, 'botton', 'brave_yxRxXbI8S5.png'));
    const fd = new FormData();
    fd.append('file', new File([png], 'image.png', { type: 'image/png' }));
    fd.append('channelId', channel.id);
    const headers = { 'X-Session-Token': token };
    const up = await fetch(`${url}/api/servers/${server.id}/upload?deviceId=device-upload-1&channelId=${channel.id}`, { method: 'POST', body: fd, headers });
    assert.equal(up.status, 201, 'image upload succeeds with channelId in query+body');
    const body = await up.json();
    assert.match(body.url, new RegExp(`^/uploads/server-${server.id}/${channel.id}/`));
    assert.equal(body.name, 'image.png');
    const uploadedFile = await fetch(`${url}${body.url}`);
    assert.equal(uploadedFile.status, 200);
    assert.equal(uploadedFile.headers.get('content-disposition'), null, 'images remain displayable inline');
    const textForm = new FormData();
    textForm.append('file', new File(['plain text'], 'note.txt', { type: 'text/plain' }));
    textForm.append('channelId', channel.id);
    const textUpload = await fetch(`${url}/api/servers/${server.id}/upload?deviceId=device-upload-1&channelId=${channel.id}`, {
      method: 'POST', body: textForm, headers
    });
    assert.equal(textUpload.status, 201);
    const textBody = await textUpload.json();
    const downloadedText = await fetch(`${url}${textBody.url}`);
    assert.equal(downloadedText.status, 200);
    assert.equal(downloadedText.headers.get('content-disposition'), 'attachment');
    const forged = new FormData();
    forged.append('file', new File(['<script>alert(1)</script>'], 'fake.png', { type: 'image/png' }));
    forged.append('channelId', channel.id);
    const rejected = await fetch(`${url}/api/servers/${server.id}/upload?deviceId=device-upload-1&channelId=${channel.id}`, { method: 'POST', body: forged, headers });
    assert.equal(rejected.status, 415, 'file contents must match the declared image type');
    // Bad channel is rejected and the file is cleaned up.
    const fd2 = new FormData();
    fd2.append('file', new File([png], 'image.png', { type: 'image/png' }));
    fd2.append('channelId', channel.id);
    const bad = await fetch(`${url}/api/servers/${server.id}/upload?deviceId=device-upload-1&channelId=00000000-0000-0000-0000-000000000000`, { method: 'POST', body: fd2, headers });
    assert.equal(bad.status, 404);
  } finally {
    await hush.stop();
  }
});

test('libraries changelog: dedicated bilingual log + header button', async () => {
  const data = JSON.parse(await readFile(path.join(PUBLIC, 'libraries-changelog.json'), 'utf8'));
  assert.ok(data.entries.length >= 3);
  for (const e of data.entries) {
    assert.ok(e.titleEn && e.titleAr, 'both languages');
    assert.ok(Array.isArray(e.pointsEn) && e.pointsEn.length);
    assert.ok(Array.isArray(e.pointsAr) && e.pointsAr.length);
    assert.ok(['mic', 'ping-op', 'giphy', 'soundboard'].includes(e.library));
  }
  assert.ok(data.entries.some((e) => e.library === 'ping-op' && e.titleAr.includes('تحسين البنق')));
  assert.ok(data.entries.some((e) => e.library === 'mic'));

  for (const page of ['room.html', 'server.html', 'index.html']) {
    const html = await readFile(path.join(PUBLIC, page), 'utf8');
    assert.match(html, /data-open-libraries-log/, `${page} has libraries button`);
    assert.match(html, /ping-op-badge/, `${page} shows PING OP badge`);
  }
  const js = await readFile(path.join(PUBLIC, 'js', 'libraries-log.js'), 'utf8');
  assert.match(js, /\/api\/libraries-changelog/);
  assert.match(js, /data-open-libraries-log/);
  const ui = await readFile(path.join(PUBLIC, 'js', 'i18n', 'ui.js'), 'utf8');
  assert.match(ui, /libraries\.title/);
  assert.match(ui, /libraries\.open/);
});
