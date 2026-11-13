import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('v12.3: emoji asset URLs are versioned so updates show immediately', async () => {
  const emojiJs = await readFile(path.join(PUBLIC, 'js', 'emoji.js'), 'utf8');
  assert.match(emojiJs, /EMOJI_ASSET_VERSION = 'twemoji-2'/, 'asset version constant');
  const versioned = emojiJs.match(/\/emoji\/[a-z0-9_]+\.svg\?v=twemoji-2/g) || [];
  assert.ok(versioned.length >= 108, `every emoji url is versioned (${versioned.length})`);
  assert.match(emojiJs, /stickers-v4/, 'sticker urls are versioned too');
  assert.doesNotMatch(emojiJs, /url: '\/emoji\/[a-z0-9]+\.svg',/, 'no unversioned emoji urls left');

  const indexHtml = await readFile(path.join(PUBLIC, 'index.html'), 'utf8');
  const hardcoded = indexHtml.match(/\/emoji\/[a-z0-9]+\.svg(?:\?v=[a-z0-9-]+)?/g) || [];
  assert.ok(hardcoded.length > 0, 'landing uses emoji imgs');
  assert.ok(hardcoded.every((u) => u.includes('?v=twemoji-2')), 'landing emoji imgs are versioned');

  const app = await readFile(path.join(ROOT, 'src', 'app.js'), 'utf8');
  assert.match(app, /isVersionedAsset/, 'server distinguishes versioned assets');
  assert.match(app, /immutable/, 'versioned assets stay immutable (safe with ?v=)');
  assert.match(app, /max-age=3600, must-revalidate/, 'other binaries revalidate hourly, not immutable a day');
});

test('v12.3: emojis are larger and the picker is wider/cleaner', async () => {
  const css = await readFile(path.join(PUBLIC, 'css', 'room.css'), 'utf8');
  assert.match(css, /\.emoji-choice \.custom-emoji \{[^}]*width: 38px;/, 'picker emoji 38px');
  assert.match(css, /\.message-emoji \{[^}]*width: 28px;/, 'inline emoji 28px');
  assert.match(css, /\.message\.is-emoji-only \.message-emoji \{[^}]*width: 48px;/, 'emoji-only 48px');
  assert.match(css, /\.emoji-menu \{[^}]*width: min\(340px/, 'menu widened to 340px');
  assert.match(css, /\.emoji-grid \{[^}]*gap: 6px/, 'grid gap 6px');
  assert.match(css, /\.emoji-choice \{[^}]*min-height: 44px/, '44px picker cells');
  for (const page of ['room.js', 'server.js']) {
    const src = await readFile(path.join(PUBLIC, 'js', page), 'utf8');
    assert.match(src, /Math\.min\(340, window\.innerWidth - 24\)/, `${page} positions the wider menu`);
  }
});

test('v12.3 changelog documents the cache fix', async () => {
  const changelog = JSON.parse(await readFile(path.join(PUBLIC, 'changelog.json'), 'utf8'));
  assert.equal(changelog.version, '15.0.0');
  const cacheFix = changelog.entries.find((e) => /Emojis now actually update/.test(e.titleEn));
  assert.ok(cacheFix, 'v12.3 cache-fix entry still present');
  assert.ok(cacheFix.pointsEn.length >= 3 && cacheFix.pointsAr.length >= 3);
});
