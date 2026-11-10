import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('v14: suspended AudioContext cannot silence remote audio', async () => {
  const media = await readFile(path.join(PUBLIC, 'js', 'room', 'media.js'), 'utf8');
  // Route via WebAudio only when the context is actually running.
  assert.match(media, /context\.state === 'running'/, 'routing gated on running context');
  // resumeAudio also resumes the mic processor context.
  assert.match(media, /micFx\?\.resume/, 'mic processor context resumed too');
  const micFx = await readFile(path.join(PUBLIC, 'js', 'room', 'mic-fx.js'), 'utf8');
  assert.match(micFx, /resume\(\) \{[^}]*this\.context/, 'MicFx exposes resume()');
});

test('v14: gestures resume mesh audio in rooms + servers', async () => {
  for (const file of ['room.js', 'server.js']) {
    const src = await readFile(path.join(PUBLIC, 'js', file), 'utf8');
    assert.match(src, /pointerdown.*resumeMeshAudio|resumeMeshAudio.*pointerdown/s, `${file} resumes on pointer`);
    assert.match(src, /state\.mesh\?\.resumeAudio\(\)/, `${file} calls mesh.resumeAudio`);
  }
});

test('room controls initialize without a temporal-dead-zone failure', async () => {
  const src = await readFile(path.join(PUBLIC, 'js', 'room.js'), 'utf8');
  const queryDeclaration = src.indexOf("const PHONE_LAYOUT_QUERY = '(max-width: 700px)'");
  const initCall = src.indexOf('\n  init();', src.indexOf('try {', src.indexOf('onLanguageChange(handleLanguageChange)')));
  assert.ok(queryDeclaration >= 0, 'phone layout query exists');
  assert.ok(initCall > queryDeclaration, 'layout query is initialized before event binding');
});

test('public pages do not rely on CSP-blocked inline font handlers', async () => {
  for (const file of ['index.html', 'room.html', 'server.html', '404.html']) {
    const html = await readFile(path.join(PUBLIC, file), 'utf8');
    assert.doesNotMatch(html, /onload=/i, `${file} has no blocked inline onload`);
    assert.match(html, /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com/, `${file} loads fonts through an allowed stylesheet`);
  }
});
