import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHushServer } from '../src/app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('dark theme tokens and toggle wiring exist', async () => {
  const tokens = await readFile(path.join(PUBLIC, 'css', 'tokens.css'), 'utf8');
  assert.match(tokens, /html\[data-theme="dark"\]/, 'dark token overrides');
  assert.match(tokens, /color-scheme: dark/, 'dark color-scheme');

  const boot = await readFile(path.join(PUBLIC, 'js', 'lang-boot.js'), 'utf8');
  assert.match(boot, /hush:theme/, 'early theme boot persists choice');
  assert.match(boot, /prefers-color-scheme: dark/, 'early theme boot respects system');

  const theme = await readFile(path.join(PUBLIC, 'js', 'theme.js'), 'utf8');
  assert.match(theme, /data-theme-toggle/, 'theme module binds toggles');
  assert.match(theme, /hush:themechange/, 'theme module emits change event');

  for (const page of ['index.html', 'room.html', '404.html']) {
    const source = await readFile(path.join(PUBLIC, page), 'utf8');
    assert.match(source, /data-theme-toggle/, `${page} offers a theme toggle`);
  }
});

test('ping endpoint and socket echo exist', async () => {
  const appSource = await readFile(path.join(ROOT, 'src', 'app.js'), 'utf8');
  assert.match(appSource, /\/api\/ping/, 'HTTP ping endpoint');
  assert.match(appSource, /Cache-Control.*no-store/, 'ping disables cache');

  const realtime = await readFile(path.join(ROOT, 'src', 'realtime.js'), 'utf8');
  assert.match(realtime, /ping:request/, 'socket ping handler');

  const ping = await readFile(path.join(PUBLIC, 'js', 'ping.js'), 'utf8');
  assert.match(ping, /data-ping-value/, 'ping renders into badges');
  assert.match(ping, /ping:request/, 'ping prefers socket round-trip');
  assert.match(ping, /\/api\/ping/, 'ping falls back to HTTP');
});

test('ping endpoint responds over HTTP', async () => {
  const hush = await createHushServer({ port: 0, host: '127.0.0.1' });
  const address = await hush.start();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/ping`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.time, 'number');
  } finally {
    await hush.stop();
  }
});
