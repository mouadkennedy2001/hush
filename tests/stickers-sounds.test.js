import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('65 permanent SVG stickers in Sticker + public/sticker with manifest', async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'Sticker', 'stickers.json'), 'utf8'));
  assert.equal(manifest.count, 65);
  assert.equal(manifest.stickers.length, 65);
  const seen = new Set();
  for (const s of manifest.stickers) {
    assert.ok(!seen.has(s.id), `duplicate ${s.id}`);
    seen.add(s.id);
    assert.ok(s.en && s.ar, 'bilingual');
    for (const base of [path.join(ROOT, 'Sticker'), path.join(PUBLIC, 'sticker')]) {
      const svg = await readFile(path.join(base, `${s.id}.svg`), 'utf8');
      assert.match(svg, /<svg/, `${s.id} svg`);
      assert.doesNotMatch(svg, /[\u{1F300}-\u{1FAFF}]/u, 'no unicode in sticker');
    }
  }
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
  assert.match(app, /welcome/, '/api/sounds lists new names');
});

test('GIF links render inline without APIs; stickers wired in both pickers', async () => {
  const emoji = await readFile(path.join(PUBLIC, 'js', 'emoji.js'), 'utf8');
  assert.match(emoji, /CUSTOM_STICKERS/);
  assert.match(emoji, /isGifUrl/);
  assert.match(emoji, /sticker-/);
  assert.match(emoji, /tenor/i, 'free GIF site linked (no key)');
  for (const page of ['server.js', 'room.js']) {
    const src = await readFile(path.join(PUBLIC, 'js', page), 'utf8');
    assert.match(src, /CUSTOM_STICKERS/, `${page} imports stickers`);
    assert.match(src, /isGifUrl/, `${page} renders GIF links`);
    assert.match(src, /tenor\.com\/search/, `${page} free search button`);
  }
  const log = JSON.parse(await readFile(path.join(PUBLIC, 'libraries-changelog.json'), 'utf8'));
  assert.ok(Array.isArray(log.entries));
});
