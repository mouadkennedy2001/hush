import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('65 UNIQUE permanent SVG stickers in Sticker + public/sticker with manifest', async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'Sticker', 'stickers.json'), 'utf8'));
  assert.equal(manifest.count, 65);
  assert.equal(manifest.stickers.length, 65);
  const seen = new Set();
  const namesEn = new Set();
  const namesAr = new Set();
  const shapes = new Set();
  for (const s of manifest.stickers) {
    assert.ok(!seen.has(s.id), `duplicate ${s.id}`);
    seen.add(s.id);
    assert.ok(s.en && s.ar, 'bilingual');
    assert.ok(!namesEn.has(s.en), `duplicate name en ${s.en}`);
    assert.ok(!namesAr.has(s.ar), `duplicate name ar ${s.ar}`);
    namesEn.add(s.en);
    namesAr.add(s.ar);
    for (const base of [path.join(ROOT, 'Sticker'), path.join(PUBLIC, 'sticker')]) {
      const svg = await readFile(path.join(base, `${s.id}.svg`), 'utf8');
      assert.match(svg, /<svg/, `${s.id} svg`);
      assert.doesNotMatch(svg, /[\u{1F300}-\u{1FAFF}]/u, 'no unicode in sticker');
      assert.doesNotMatch(svg, /<script/i, 'no script in sticker');
      // Shape signature ignoring colors — v12: all 65 must be unique,
      // the old set repeated only 5 shapes in different colors.
      shapes.add(svg.replace(/#[0-9a-fA-F]{6}/g, '#C'));
    }
  }
  assert.equal(shapes.size, 65, 'every sticker drawing is unique (no repeated shapes)');
  const stray = (await readdir(path.join(PUBLIC, 'sticker'))).filter((f) => f.endsWith('.svg'));
  assert.equal(stray.length, 65);
});

test('12 new UI sounds are real WAVs and wired', async () => {
  const names = ['welcome', 'goodbye', 'coin', 'levelup', 'warning', 'achievement', 'whoosh', 'chime', 'bubble', 'slide', 'dingdong', 'echo'];
  for (const name of names) {
    const buf = await readFile(path.join(PUBLIC, 'sounds', `${name}.wav`));
    assert.ok(buf.length > 1000, `${name}.wav too small`);
    assert.equal(buf.subarray(0, 4).toString(), 'RIFF');
  }
  const sounds = await readFile(path.join(PUBLIC, 'js', 'sounds.js'), 'utf8');
  for (const name of names) assert.match(sounds, new RegExp(`'${name}'|${name}:`), `sounds.js knows ${name}`);
  const app = await readFile(path.join(ROOT, 'src', 'app.js'), 'utf8');
  assert.match(app, /UI_SOUND_IDS/, '/api/sounds lists UI sounds');
  const constants = await readFile(path.join(ROOT, 'src', 'constants.js'), 'utf8');
  assert.match(constants, /'welcome'/, 'UI_SOUND_IDS includes welcome');
});

test('GIF links render inline; Giphy via server proxy; stickers wired in both pickers', async () => {
  const emoji = await readFile(path.join(PUBLIC, 'js', 'emoji.js'), 'utf8');
  assert.match(emoji, /CUSTOM_STICKERS/);
  assert.match(emoji, /isGifUrl/);
  assert.match(emoji, /sticker-/);
  assert.match(emoji, /gif-broken/, 'broken-GIF fallback (error/ fix)');
  for (const page of ['server.js', 'room.js']) {
    const src = await readFile(path.join(PUBLIC, 'js', page), 'utf8');
    assert.match(src, /CUSTOM_STICKERS/, `${page} imports stickers`);
    assert.match(src, /isGifUrl/, `${page} renders GIF links`);
    assert.match(src, /gif-panel/, `${page} uses shared Giphy panel`);
  }
  const panel = await readFile(path.join(PUBLIC, 'js', 'gif-panel.js'), 'utf8');
  assert.match(panel, /tenor\.com\/search/, 'free search button kept');
  assert.match(panel, /searchGifs/, 'Giphy search wired');
  assert.match(panel, /trendingGifs/, 'Giphy trending wired');
  const giphyClient = await readFile(path.join(PUBLIC, 'js', 'giphy.js'), 'utf8');
  assert.match(giphyClient, /\/api\/gif\//, 'client only talks to server proxy');
  assert.doesNotMatch(giphyClient, /api_key|GIPHY_API_KEY/, 'no key in browser code');
  const log = JSON.parse(await readFile(path.join(PUBLIC, 'libraries-changelog.json'), 'utf8'));
  assert.ok(Array.isArray(log.entries));
});
