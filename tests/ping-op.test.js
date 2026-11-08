import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('PING OP v1.0 library exists from scratch and is wired', async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'PING OP', 'package.json'), 'utf8'));
  assert.equal(pkg.version, '1.0.0');
  const ver = JSON.parse(await readFile(path.join(ROOT, 'PING OP', 'version.json'), 'utf8'));
  assert.equal(ver.version, '1.0.0');
  assert.equal(ver.status, 'active');
  assert.equal(ver.writtenFromScratch, true);

  const core = await readFile(path.join(ROOT, 'PING OP', 'src', 'ping-op.js'), 'utf8');
  assert.match(core, /createPingOp/);
  assert.match(core, /PING_OP_VERSION = '1\.0\.0'/);
  assert.match(core, /qualityFor/);
  const server = await readFile(path.join(ROOT, 'PING OP', 'src', 'server.js'), 'utf8');
  assert.match(server, /createPingServer/);
  assert.match(server, /applyHardening/);
  const client = await readFile(path.join(ROOT, 'PING OP', 'src', 'client.js'), 'utf8');
  assert.match(client, /PROBES = 2/);
  assert.match(client, /ping:request/);

  const app = await readFile(path.join(ROOT, 'src', 'app.js'), 'utf8');
  assert.match(app, /PING OP\/src\/server/, 'server imports PING OP');
  assert.match(app, /setNoDelay/, 'TCP_NODELAY kept');
  const ping = await readFile(path.join(PUBLIC, 'js', 'ping.js'), 'utf8');
  assert.match(ping, /ping-op\/ping-op/, 'UI feeds the PING OP core');
});

test('server voice: text exit trap, occupants and temp tiles are fixed', async () => {
  const serverJs = await readFile(path.join(PUBLIC, 'js', 'server.js'), 'utf8');
  // Trap fix: clicking a text channel while in voice exits voice first.
  assert.match(serverJs, /wasVoice/);
  assert.match(serverJs, /lastTextChannelId/);
  assert.match(serverJs, /leaveVoiceChip/);
  // Occupants under voice channels + temp rooms.
  assert.match(serverJs, /server:voice:occupancy/);
  assert.match(serverJs, /server-voice-occupants/);
  // Temp create/join now init media + tiles (was empty black stage).
  assert.match(serverJs, /enterVoiceMedia/);
  assert.match(serverJs, /state\.mesh\?\.init/);
  // Tiles filtered to the current voice context.
  assert.match(serverJs, /currentOccupants/);

  const realtime = await readFile(path.join(ROOT, 'src', 'realtime.js'), 'utf8');
  assert.match(realtime, /voiceOccupancy/);
  assert.match(realtime, /emitVoiceOccupancy/);
  assert.match(realtime, /trackVoice/);
  assert.match(realtime, /trackTemp/);
  // ping:request now owned by PING OP (comment kept for back-compat).
  assert.match(realtime, /PING OP v1\.0 owns/);

  const html = await readFile(path.join(PUBLIC, 'server.html'), 'utf8');
  assert.match(html, /id="leave-voice-chip"/, 'persistent leave chip in header');
  const css = await readFile(path.join(PUBLIC, 'css', 'server.css'), 'utf8');
  assert.match(css, /\.server-voice-occupants/, 'occupant list styles');
});

test('mic ev1.1: settings sanitized, gate fixed, worklet suppresses', async () => {
  const sanitizer = await readFile(path.join(PUBLIC, 'js', 'room', 'mic-settings.js'), 'utf8');
  assert.match(sanitizer, /sanitizeMicSettings/);
  assert.match(sanitizer, /DEVICE_ID_RE/);
  const fx = await readFile(path.join(PUBLIC, 'js', 'room', 'mic-fx.js'), 'utf8');
  assert.match(fx, /sanitizeMicSettings/);
  assert.match(fx, /0\.4/, 'monitor capped against feedback');
  const enhancer = await readFile(path.join(PUBLIC, 'js', 'room', 'mic-enhancer.js'), 'utf8');
  assert.match(enhancer, /Analyser/);
  assert.match(enhancer, /ownedCtx/);
  const worklet = await readFile(path.join(PUBLIC, 'js', 'room', 'noise-suppress-processor.js'), 'utf8');
  assert.match(worklet, /hush-noise-suppress/);
  assert.match(worklet, /MIN_GAIN/);
  assert.doesNotMatch(worklet, /output\[i\] = s;\n/, 'worklet no longer a no-op copy');
  const media = await readFile(path.join(PUBLIC, 'js', 'room', 'media.js'), 'utf8');
  assert.match(media, /audioContext/, 'shared AudioContext');
  assert.match(media, /OverconstrainedError/, 'device fallback');
});
