import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ui } from '../public/js/i18n/ui.js';
import { staticAr } from '../public/js/i18n/static-ar.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

async function listFiles(dir, extension) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'i18n') continue;
      files.push(...(await listFiles(full, extension)));
    } else if (entry.name.endsWith(extension)) {
      files.push(full);
    }
  }
  return files;
}

function placeholders(value) {
  return [...String(value).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

test('every UI dictionary entry has English and Arabic text', () => {
  for (const [key, entry] of Object.entries(ui)) {
    assert.equal(entry.length, 2, `${key} must be [en, ar]`);
    assert.ok(entry[0].trim().length > 0, `${key} is missing English`);
    assert.ok(entry[1].trim().length > 0, `${key} is missing Arabic`);
  }
});

test('translations keep the same placeholders as English', () => {
  for (const [key, entry] of Object.entries(ui)) {
    assert.deepEqual(
      placeholders(entry[1]),
      placeholders(entry[0]),
      `${key} has mismatched placeholders`
    );
  }
});

test('every translation key used by client code exists', async () => {
  const keyPattern =
    /['"]((?:lang|theme|ping|settings|stats|meta|status|join|error|chat|screen|control|media|upload|toast|confirm|tools|shortcuts|landing|date)\.[A-Za-z0-9_.]+)['"]/g;

  const files = await listFiles(path.join(PUBLIC, 'js'), '.js');
  const used = new Set();

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(keyPattern)) used.add(match[1]);
  }

  const missing = [...used].filter((key) => !(key in ui)).sort();
  assert.deepEqual(missing, [], `missing UI keys: ${missing.join(', ')}`);
});

test('static Arabic map only contains real translations', () => {
  for (const [english, arabic] of Object.entries(staticAr)) {
    assert.ok(english.trim().length > 0, 'empty static key');
    assert.ok(String(arabic).trim().length > 0, `empty translation for “${english}”`);
  }
});

test('static HTML attributes are covered by the Arabic map', async () => {
  const pages = ['index.html', 'room.html', '404.html'];
  const allowed = new Set(['GitHub', 'Instagram', 'ABC-123']);
  const missing = [];

  for (const page of pages) {
    const source = await readFile(path.join(PUBLIC, page), 'utf8');
    for (const match of source.matchAll(/(?:placeholder|title|aria-label)="([^"]+)"/g)) {
      const value = match[1].trim();
      if (!value || allowed.has(value) || /[{}]/.test(value)) continue;
      if (!(value in staticAr)) missing.push(`${page}: ${value}`);
    }
  }

  assert.deepEqual([...new Set(missing)].sort(), []);
});

test('pages boot language early and render both language toggles', async () => {
  for (const page of ['index.html', 'room.html', '404.html']) {
    const source = await readFile(path.join(PUBLIC, page), 'utf8');
    assert.match(source, /\/js\/lang-boot\.js/, `${page} should load lang-boot`);
    assert.match(source, /data-lang-toggle/, `${page} should offer a language toggle`);
    assert.match(source, /data-theme-toggle/, `${page} should offer a theme toggle`);
  }
});

test('developer credit and social links appear on every page', async () => {
  for (const page of ['index.html', 'room.html', '404.html']) {
    const source = await readFile(path.join(PUBLIC, page), 'utf8');
    assert.match(source, /Zerouki Ahmed Mouad/, `${page} should credit the developer`);
    assert.match(source, /زروقي احمد معاذ/, `${page} should include the Arabic name`);
    assert.match(source, /github\.com\/mouadkennedy2001/, `${page} should link to GitHub`);
    assert.match(source, /instagram\.com\/mouad_kennedy/, `${page} should link to Instagram`);
  }
});
