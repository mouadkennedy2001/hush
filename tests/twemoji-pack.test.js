import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const EMOJI_DIR = path.join(PUBLIC, 'emoji');

test('v12.2: all 108 emojis are the Twemoji pack (hush_emoji_pro), ids match code', async () => {
  const ids = JSON.parse(await readFile(path.join(EMOJI_DIR, 'ids.json'), 'utf8'));
  assert.equal(ids.length, 108);
  const manifest = JSON.parse(await readFile(path.join(EMOJI_DIR, 'manifest.json'), 'utf8'));
  assert.equal(manifest.length, 108);
  for (const entry of manifest) {
    assert.equal(entry.source, 'twemoji', `${entry.id} comes from Twemoji`);
    assert.ok(entry.svg, `${entry.id} has svg`);
  }
  const files = (await readdir(EMOJI_DIR)).filter((f) => f.endsWith('.svg')).sort();
  assert.equal(files.length, 108, '108 svg files');
  assert.deepEqual(files.map((f) => f.replace('.svg', '')).sort(), [...ids].sort(), 'files match ids.json');
  const pngs = await readdir(path.join(EMOJI_DIR, 'png'));
  assert.equal(pngs.length, 108, '108 png files');
  const preview = await readFile(path.join(EMOJI_DIR, 'preview.png'));
  assert.ok(preview.length > 10000, 'preview.png exists');

  // The 5 former hand-made outliers are now real Twemoji drawings.
  for (const id of ['wave', 'wink', 'wow', 'yay', 'trombone']) {
    const svg = await readFile(path.join(EMOJI_DIR, `${id}.svg`), 'utf8');
    assert.match(svg, /viewBox="0 0 36 36"/, `${id} is the Twemoji 36x36 drawing`);
    assert.doesNotMatch(svg, /viewBox="0 0 64 64"/, `${id} is not the old hand-made 64x64 drawing`);
  }
  // No old hand-made emoji remains anywhere in the pack.
  for (const f of files) {
    const svg = await readFile(path.join(EMOJI_DIR, f), 'utf8');
    assert.match(svg, /viewBox="0 0 36 36"/, `${f} is a Twemoji drawing`);
    assert.doesNotMatch(svg, /<script/i, `${f} has no script`);
    assert.doesNotMatch(svg, /on\w+\s*=/i, `${f} has no event handlers`);
    assert.doesNotMatch(svg, /href\s*=\s*"https?:/i, `${f} has no external href`);
  }
  // Code ids still match the pack exactly (shortcodes keep working).
  const emojiJs = await readFile(path.join(PUBLIC, 'js', 'emoji.js'), 'utf8');
  const jsIds = [...emojiJs.matchAll(/\{ id: '([a-z0-9_]+)', url: '\/emoji\//g)].map((m) => m[1]);
  assert.deepEqual([...jsIds].sort(), [...ids].sort(), 'CUSTOM_EMOJIS ids match the pack');
  const constants = await readFile(path.join(ROOT, 'src', 'constants.js'), 'utf8');
  for (const id of ids) assert.match(constants, new RegExp(`'${id}'`), `server allow-list knows ${id}`);
});

test('v12.2: Twemoji attribution is visible (CC-BY 4.0) and forge source is gitignored', async () => {
  const attribution = await readFile(path.join(EMOJI_DIR, 'ATTRIBUTION.md'), 'utf8');
  assert.match(attribution, /Twemoji/);
  assert.match(attribution, /CC-BY 4\.0/);
  for (const page of ['index.html', 'room.html', 'server.html']) {
    const html = await readFile(path.join(PUBLIC, page), 'utf8');
    assert.match(html, /github\.com\/jdecked\/twemoji/, `${page} links Twemoji for attribution`);
    assert.match(html, /Twemoji \(CC-BY 4\.0\)/, `${page} shows the CC-BY credit`);
  }
  const readme = await readFile(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /Twemoji/, 'README credits Twemoji');
  const gitignore = await readFile(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gitignore, /^new emoji\/$/m, 'forge source folder is gitignored');
  const emojiReadme = await readFile(path.join(EMOJI_DIR, 'README.md'), 'utf8');
  assert.match(emojiReadme, /Twemoji/, 'emoji README describes the pack');
  assert.match(emojiReadme, /emoji_forge\.py/, 'emoji README documents regeneration');
});

test('v12.2 changelog documents the emoji replacement', async () => {
  const changelog = JSON.parse(await readFile(path.join(PUBLIC, 'changelog.json'), 'utf8'));
  assert.equal(changelog.version, '14.0.0');
  assert.match(changelog.entries[0].titleEn, /v14/);
  assert.ok(changelog.entries.some((e) => /Twemoji pack/.test(e.titleEn)), 'v12.2 entry still present');
  assert.ok(changelog.entries[0].pointsEn.length >= 3 && changelog.entries[0].pointsAr.length >= 3);
});
