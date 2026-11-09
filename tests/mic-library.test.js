import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIC = path.join(ROOT, 'mic');

test('mic library: mic_ev1 ships a complete fail-safe enhancer', async () => {
  const readme = await readFile(path.join(MIC, 'README.md'), 'utf8');
  assert.match(readme, /mic_ev1/i);
  assert.match(readme, /mic_ev2/i, 'evolution plan reaches ev2');

  const changelog = await readFile(path.join(MIC, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /mic_ev1/, 'changelog documents ev1');
  assert.match(changelog, /mic_ev2/, 'changelog plans ev2');

  const entry = await readFile(path.join(MIC, 'mic_ev1', 'src', 'mic-enhancer.js'), 'utf8');
  assert.match(entry, /createMicEnhancer/);
  assert.match(entry, /bypass/, 'fail-safe bypass exists');
  assert.match(entry, /attach/, 'attach() API present');

  const spectral = await readFile(path.join(MIC, 'mic_ev1', 'src', 'spectral.js'), 'utf8');
  assert.match(spectral, /SpectralSuppressor/);

  const worklet = await readFile(path.join(MIC, 'mic_ev1', 'worklet', 'noise-suppress-processor.js'), 'utf8');
  assert.match(worklet, /registerProcessor/, 'AudioWorklet processor registered');

  for (const v of ['mic_ev1.1', 'mic_ev1.3', 'mic_ev1.4', 'mic_ev1.5', 'mic_ev1.6', 'mic_ev1.7', 'mic_ev1.8', 'mic_ev1.9', 'mic_ev2']) {
    const st = await stat(path.join(MIC, v, 'README.md'));
    assert.ok(st.isFile(), `${v} has a README`);
    const ver = JSON.parse(await readFile(path.join(MIC, v, 'version.json'), 'utf8'));
    assert.equal(ver.status, 'planned', `${v} is planned`);
  }
  // ev1.2 is live in the ev1 entrypoint (same pattern as ev1.1).
  const ev12 = JSON.parse(await readFile(path.join(MIC, 'mic_ev1.2', 'version.json'), 'utf8'));
  assert.equal(ev12.status, 'active', 'ev1.2 is live');
  assert.match(entry, /MIC_VERSION = 'ev1\.2'/, 'canonical enhancer is ev1.2');
  assert.match(entry, /getLevel/, 'live level API');
  assert.match(entry, /setBypass/, 'live bypass API');
  const ev1 = JSON.parse(await readFile(path.join(MIC, 'mic_ev1', 'version.json'), 'utf8'));
  assert.equal(ev1.status, 'active', 'ev1 is the active version');
});

test('mic browser runtime: fallback-safe, no external dependencies', async () => {
  const runtime = await readFile(path.join(ROOT, 'public', 'js', 'room', 'mic-enhancer.js'), 'utf8');
  assert.match(runtime, /createMicEnhancer/);
  assert.match(runtime, /bypass/);
  assert.doesNotMatch(runtime, /from\s+['"]https?:/, 'no CDN/import-map dependency');
  const processor = await readFile(path.join(ROOT, 'public', 'js', 'room', 'noise-suppress-processor.js'), 'utf8');
  assert.match(processor, /hush-noise-suppress/);
  const media = await readFile(path.join(ROOT, 'public', 'js', 'room', 'media.js'), 'utf8');
  assert.match(media, /createMicEnhancer/, 'MediaMesh wires the enhancer');
  const fx = await readFile(path.join(ROOT, 'public', 'js', 'room', 'mic-fx.js'), 'utf8');
  assert.match(fx, /mic_ev1/, 'settings reference mic_ev1');
  assert.match(fx, /enhance/, 'enhance setting exists');
});
