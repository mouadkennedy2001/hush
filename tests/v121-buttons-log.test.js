import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('v12.1: dedicated GIF + Sticker buttons beside the composer (rooms + servers)', async () => {
  for (const page of ['room.html', 'server.html']) {
    const html = await readFile(path.join(PUBLIC, page), 'utf8');
    assert.match(html, /id="gif-btn"/, `${page} has a GIF button`);
    assert.match(html, /id="gif-menu"/, `${page} has a separate GIF menu`);
    assert.match(html, /id="sticker-btn"/, `${page} has a sticker button`);
    assert.match(html, /id="sticker-menu"/, `${page} has a separate sticker menu`);
    assert.match(html, /#i-gif/, `${page} GIF icon`);
    assert.match(html, /#i-sticker/, `${page} sticker icon`);
    // Buttons sit inside the composer, before the textarea.
    const composer = html.slice(html.indexOf('class="composer"'), html.indexOf('id="message-input"'));
    assert.match(composer, /id="gif-btn"/, `${page} GIF button is beside the chat box`);
    assert.match(composer, /id="sticker-btn"/, `${page} sticker button is beside the chat box`);
  }
  for (const page of ['room.js', 'server.js']) {
    const src = await readFile(path.join(PUBLIC, 'js', page), 'utf8');
    assert.match(src, /buildGifMenu/, `${page} builds the GIF menu`);
    assert.match(src, /buildStickerMenuPanel/, `${page} builds the sticker menu`);
    assert.match(src, /toggleGifMenu/, `${page} toggles GIF menu`);
    assert.match(src, /toggleStickerMenu/, `${page} toggles sticker menu`);
    assert.match(src, /buildStickerMenu/, `${page} uses shared sticker menu`);
  }
  const panel = await readFile(path.join(PUBLIC, 'js', 'gif-panel.js'), 'utf8');
  assert.match(panel, /buildStickerMenu/, 'shared sticker menu builder');
  assert.match(panel, /is-panel/, 'GIF panel escapes the emoji grid (broken-layout fix)');
});

test('v12.1: GIF panel is not crushed into the 6-column emoji grid', async () => {
  const css = await readFile(path.join(PUBLIC, 'css', 'room.css'), 'utf8');
  assert.match(css, /\.emoji-grid\.is-panel\s*\{\s*display:\s*block/, 'panel grid becomes block');
  assert.match(css, /\.gif-panel\s*\{/, 'panel wrapper styles');
  assert.match(css, /\.gif-row\s*\{[^}]*align-items:\s*center/, 'rows align center, not stretch');
  const panel = await readFile(path.join(PUBLIC, 'js', 'gif-panel.js'), 'utf8');
  assert.match(panel, /grid\.classList\.add\('is-panel'\)/, 'panel switches grid to block');
  assert.match(panel, /gif-panel/, 'panel wrapper created');
});

test('v12.1: GIFs and stickers are LARGE in chat', async () => {
  const css = await readFile(path.join(PUBLIC, 'css', 'room.css'), 'utf8');
  assert.match(css, /\.message-gif\s*\{[^}]*min\(340px/, 'GIF up to 340px');
  assert.match(css, /\.message-sticker\s*\{[^}]*width:\s*56px/, 'inline sticker 56px');
  assert.match(css, /\.message\.is-emoji-only \.message-sticker\s*\{[^}]*width:\s*128px/, 'sticker alone 128px');
});

test('v12.1: sticker filters are translated (Arabic in ar, English in en)', async () => {
  for (const page of ['room.js', 'server.js']) {
    const src = await readFile(path.join(PUBLIC, 'js', page), 'utf8');
    assert.match(src, /locale\(\) === 'ar' \? cat\.ar : cat\.en/, `${page} sticker tabs use current language`);
    assert.doesNotMatch(src, /emoji-tab sticker-tab', cat\.en/, `${page} no hardcoded English sticker tabs`);
  }
  const panel = await readFile(path.join(PUBLIC, 'js', 'gif-panel.js'), 'utf8');
  assert.match(panel, /lang\(\) === 'ar' \? cat\.ar : cat\.en/, 'dedicated sticker menu tabs are localized');
  // Menus rebuild on language change so tabs actually switch language.
  const room = await readFile(path.join(PUBLIC, 'js', 'room.js'), 'utf8');
  assert.match(room, /buildRoomEmojiMenu\(\)[\s\S]*buildGifMenu\(\)[\s\S]*buildStickerMenuPanel\(\)/, 'room rebuilds pickers on language change');
  const server = await readFile(path.join(PUBLIC, 'js', 'server.js'), 'utf8');
  assert.match(server, /buildEmojiMenu\(\)[\s\S]*buildGifMenu\(\)[\s\S]*buildStickerMenuPanel\(\)/, 'server rebuilds pickers on language change');
  // Every new UI key exists in both languages.
  const { ui } = await import('../public/js/i18n/ui.js');
  for (const key of ['composer.gif', 'composer.sticker', 'composer.gifTitle', 'composer.stickerTitle', 'name.hint', 'name.count', 'log.search', 'log.filterAll', 'log.filterUpdate', 'log.filterFix', 'log.filterSecurity', 'log.filterFeature', 'log.results']) {
    assert.ok(ui[key], `ui key ${key} exists`);
    assert.equal(ui[key].length, 2, `${key} bilingual`);
  }
});

test('v12.1: display-name box has icon + counter + label (rooms + servers)', async () => {
  for (const page of ['room.html', 'server.html']) {
    const html = await readFile(path.join(PUBLIC, page), 'utf8');
    assert.match(html, /class="field name-field"/, `${page} name field class`);
    assert.match(html, /name-field-icon/, `${page} user icon inside the field`);
    assert.match(html, /id="name-count"/, `${page} character counter`);
    assert.match(html, /name-field-hint/, `${page} hint text`);
    assert.match(html, /id="name-input"[^>]*dir="auto"/, `${page} input keeps dir=auto`);
    assert.match(html, /maxlength="32"/, `${page} 32-char cap kept`);
  }
  const css = await readFile(path.join(PUBLIC, 'css', 'room.css'), 'utf8');
  assert.match(css, /\.name-field\s*\{/, 'name field styles exist in room.css (was unstyled)');
  assert.match(css, /\.name-field #name-input\s*\{[^}]*height:\s*52px/, '52px tall input');
  assert.match(css, /padding-inline-start:\s*44px/, 'icon space inside the input');
  assert.match(css, /\.name-field-count/, 'counter styles');
  for (const page of ['room.js', 'server.js']) {
    const src = await readFile(path.join(PUBLIC, 'js', page), 'utf8');
    assert.match(src, /updateNameCount/, `${page} updates the counter`);
    assert.match(src, /name\.count/, `${page} counter is translated`);
  }
});

test('v12.1: Log has search + kind filters, cards wrap without clipping', async () => {
  const log = await readFile(path.join(PUBLIC, 'js', 'changelog.js'), 'utf8');
  assert.match(log, /changelog-search/, 'log search input');
  assert.match(log, /changelog-tabs/, 'log kind filter tabs');
  assert.match(log, /activeKind/, 'log kind filter state');
  assert.match(log, /log\.search/, 'log search is translated');
  assert.match(log, /log\.filterAll/, 'log filter labels are translated');
  assert.match(log, /log\.results/, 'log result count');
  assert.match(log, /renderTabs/, 'log tabs re-render on language change');
  const css = await readFile(path.join(PUBLIC, 'css', 'room.css'), 'utf8');
  assert.match(css, /\.changelog-list\s*\{[^}]*overflow-y:\s*auto/, 'log list scrolls inside the dialog');
  assert.match(css, /\.changelog-card h3\s*\{[^}]*overflow-wrap:\s*anywhere/, 'titles wrap (no Arabic clipping)');
  assert.match(css, /\.changelog-points li\s*\{[^}]*overflow-wrap:\s*anywhere/, 'points wrap');
  assert.match(css, /\.changelog-date\s*\{[^}]*unicode-bidi:\s*isolate/, 'dates isolated LTR');
  assert.match(css, /\.changelog-tag\.is-security/, 'security tag color');
  const landingCss = await readFile(path.join(PUBLIC, 'css', 'landing.css'), 'utf8');
  assert.match(landingCss, /\.changelog-list\s*\{[^}]*overflow-y:\s*auto/, 'landing log also scrolls');
});

test('v12.1 changelog documents buttons, sizes, name box and log (v12.2 on top)', async () => {
  const changelog = JSON.parse(await readFile(path.join(PUBLIC, 'changelog.json'), 'utf8'));
  assert.equal(changelog.version, '12.3.0');
  const top = changelog.entries[0];
  assert.match(top.titleEn, /Emojis now actually update/);
  assert.ok(changelog.entries.some((e) => /GIF \+ Sticker buttons/.test(e.titleEn)), 'v12.1 entry still present');
  assert.ok(top.pointsEn.length >= 3 && top.pointsAr.length >= 3, 'bilingual v12.2 points');
});
