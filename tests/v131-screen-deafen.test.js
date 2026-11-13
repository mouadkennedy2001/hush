import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('v13.1: room screen stage attaches like the server (no videoWidth gate)', async () => {
  const room = await readFile(path.join(PUBLIC, 'js', 'room.js'), 'utf8');
  const stageFn = room.slice(room.indexOf('function updateScreenStage()'), room.indexOf('function cycleScreenShare()'));
  assert.ok(!stageFn.includes('streamHasVideo(stream);\n\n  els.screenStage.hidden = false') || stageFn.includes('hasStream'), 'no hard videoWidth gate before attach');
  assert.match(stageFn, /hasStream/, 'attaches whenever a live stream exists');
  assert.match(room, /loadeddata/, 'placeholder hides on first frame');
  const media = await readFile(path.join(PUBLIC, 'js', 'room', 'media.js'), 'utf8');
  assert.match(media, /track\.readyState === 'live' && !track\.muted/, 'muted is the frames signal');
  const fn = media.slice(media.indexOf('export function streamHasVideo'), media.indexOf('function friendlyMediaError'));
  assert.doesNotMatch(fn, /videoWidth/, 'videoWidth must not gate rendering');
});

test('v13.1: deafen cannot be undone by settings (mesh owns gains)', async () => {
  const settings = await readFile(path.join(PUBLIC, 'js', 'settings.js'), 'utf8');
  assert.match(settings, /registerVolumeSink/, 'settings forwards to the mesh');
  assert.doesNotMatch(settings, /audio\.muted = false/, 'settings never un-mutes remote audio');
  assert.doesNotMatch(settings, /audio\.volume = effective/, 'settings never writes element volume');
  const media = await readFile(path.join(PUBLIC, 'js', 'room', 'media.js'), 'utf8');
  assert.match(media, /peer\.audioEl\.muted = effective === 0/, 'fallback elements mute at 0');
  const room = await readFile(path.join(PUBLIC, 'js', 'room.js'), 'utf8');
  assert.match(room, /setMasterVolume\(master\)/, 'real master passed (not 0 while deafened)');
  assert.match(room, /deafened: state\.deafened/, 'deafen state is broadcast');
  const realtime = await readFile(path.join(ROOT, 'src', 'realtime.js'), 'utf8');
  assert.match(realtime, /participant\.deafened/, 'server relays deafen state');
});

test('v13.1: enlarge screen button in rooms + servers (botton/)', async () => {
  const roomHtml = await readFile(path.join(PUBLIC, 'room.html'), 'utf8');
  assert.match(roomHtml, /id="screen-enlarge"/, 'enlarge in rooms');
  assert.match(roomHtml, /id="i-expand"/, 'expand icon symbol');
  const serverHtml = await readFile(path.join(PUBLIC, 'server.html'), 'utf8');
  assert.match(serverHtml, /id="server-screen-enlarge"/, 'enlarge in servers');
  const css = await readFile(path.join(PUBLIC, 'css', 'room.css'), 'utf8');
  assert.match(css, /\.screen-enlarge-btn/, 'enlarge button styles');
  assert.match(css, /:fullscreen/, 'fullscreen stage styles');
  const room = await readFile(path.join(PUBLIC, 'js', 'room.js'), 'utf8');
  assert.match(room, /is-enlarged/, 'fixed overlay enlarge in rooms');
  const server = await readFile(path.join(PUBLIC, 'js', 'server.js'), 'utf8');
  assert.match(server, /is-enlarged/, 'fixed overlay enlarge in servers');
});

test('v13.1: 108 Twemoji + Twemoji stickers', async () => {
  const { CUSTOM_EMOJIS, CUSTOM_STICKERS } = await import('../public/js/emoji.js');
  assert.equal(CUSTOM_EMOJIS.length, 108);
  for (const id of ['grinning', 'rolling_laugh', 'melting', 'cowboy', 'victory_hand', 'handshake', 'crown', 'moon', 'cat2', 'dog', 'fox', 'burger', 'key']) {
    assert.ok(CUSTOM_EMOJIS.some((e) => e.id === id), `new emoji ${id}`);
    await access(path.join(PUBLIC, 'emoji', `${id}.svg`));
  }
  assert.equal(CUSTOM_STICKERS.length, 65);
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'Sticker', 'stickers.json'), 'utf8'));
  assert.equal(manifest.version, '4.0.0');
  for (const s of manifest.stickers) {
    assert.ok(s.emojiId, `${s.id} maps to an emoji`);
    const emoji = CUSTOM_EMOJIS.find((e) => e.id === s.emojiId);
    assert.ok(emoji, `${s.emojiId} exists`);
    const stickerSvg = await readFile(path.join(PUBLIC, 'sticker', `${s.id}.svg`), 'utf8');
    assert.match(stickerSvg, /<svg/, `${s.id} is an SVG`);
    assert.doesNotMatch(stickerSvg, /<script/i, `${s.id} has no script`);
    assert.ok(stickerSvg.length > 200, `${s.id} is a real OpenMoji drawing, not a stub`);
  }
});

test('v13.1: security — HSTS + rate limits on leave/history', async () => {
  const app = await readFile(path.join(ROOT, 'src', 'app.js'), 'utf8');
  assert.match(app, /Strict-Transport-Security/, 'HSTS header');
  assert.match(app, /servers\/:id\/leave', leaveLimit/, 'leave rate-limited');
  assert.match(app, /servers\/:id\/history', historyLimit/, 'history rate-limited');
});
