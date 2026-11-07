import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CUSTOM_EMOJI_IDS, REACTION_EMOJIS } from '../src/constants.js';
import { isAllowedReaction, isAllowedFloatingReaction } from '../src/rooms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

test('every custom emoji id has an SVG file', async () => {
  assert.ok(CUSTOM_EMOJI_IDS.length >= 40, `expected 40+ emojis, got ${CUSTOM_EMOJI_IDS.length}`);
  for (const id of CUSTOM_EMOJI_IDS) {
    const svg = await readFile(path.join(PUBLIC, 'emoji', `${id}.svg`), 'utf8');
    assert.match(svg, /<svg/, `${id}.svg`);
  }
});

test('reactions are custom ids only, unicode rejected', () => {
  for (const id of REACTION_EMOJIS) assert.ok(CUSTOM_EMOJI_IDS.includes(id), id);
  assert.equal(isAllowedReaction('thumbsup'), true);
  assert.equal(isAllowedReaction('tada'), true);
  assert.equal(isAllowedReaction('👍'), false, 'unicode thumbs up must be rejected');
  assert.equal(isAllowedReaction('🎉'), false);
  assert.equal(isAllowedFloatingReaction('laugh'), true);
  assert.equal(isAllowedFloatingReaction('custom:laugh'), true, 'legacy prefix normalized');
  assert.equal(isAllowedFloatingReaction('😂'), false);
});

test('whole site contains no unicode/global emojis in public assets', async () => {
  async function list(dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...await list(full));
      else if (/\.(js|html|css|json)$/.test(entry.name)) out.push(full);
    }
    return out;
  }
  const files = await list(PUBLIC);
  const offenders = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (EMOJI_RE.test(text)) offenders.push(path.relative(ROOT, file));
  }
  assert.deepEqual(offenders, [], `unicode emojis in: ${offenders.join(', ')}`);
});

test('chat renders custom emoji shortcodes as images', async () => {
  const room = await readFile(path.join(PUBLIC, 'js', 'room.js'), 'utf8');
  assert.match(room, /splitEmojiShortcodes/, 'shortcode renderer wired');
  assert.match(room, /customEmojiImage\(part\.emoji/, 'shortcode becomes an image');
  assert.match(room, /insertEmoji\(`:\$\{emoji\}:`\)/, 'picker inserts a shortcode');
  const emojiModule = await readFile(path.join(PUBLIC, 'js', 'emoji.js'), 'utf8');
  assert.match(emojiModule, /splitEmojiShortcodes/, 'shared shortcode parser');
});
