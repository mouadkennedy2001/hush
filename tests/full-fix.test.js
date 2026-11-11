import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isBanned } from '../src/security.js';
import { generateCode } from '../src/rooms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('security helpers: isBanned expiry is per-identifier', () => {
  const now = Date.now();
  const bans = [
    { deviceHash: 'd1', ipHash: 'i1', until: now - 1000 },
    { deviceHash: 'd2', ipHash: 'i2', until: now + 60_000 }
  ];
  // Expired device ban must not shadow the active IP ban.
  const hit = isBanned(bans, { deviceHash: 'd1', ipHash: 'i2' });
  assert.ok(hit && hit.deviceHash === 'd2', 'active entry wins');
  assert.equal(isBanned(bans, { deviceHash: 'd1', ipHash: 'other' }), null);
  assert.equal(isBanned(bans, { deviceHash: 'nobody' }), null);
});

test('room codes use crypto RNG by default', () => {
  const a = generateCode(6);
  const b = generateCode(6);
  assert.match(a, /^[A-Z0-9]{6}$/);
  assert.notEqual(a, b);
});

test('frontend: nested buttons removed, emoji dialog+keyboard, tiles badges', async () => {
  const serverJs = await readFile(path.join(PUBLIC, 'js', 'server.js'), 'utf8');
  assert.ok(!serverJs.includes('link.append(del)'), 'channel delete is sibling not nested');
  assert.ok(!serverJs.includes('link.append(rename)'), 'temp rename is sibling not nested');
  assert.match(serverJs, /tile-badge/, 'server tiles show mute/screen badges');
  assert.match(serverJs, /setAttribute\('role', 'dialog'\)/, 'emoji dialog role');
  assert.match(serverJs, /setAttribute\('inert', ''\)/, 'gate inert');
  assert.match(serverJs, /selfMemberId/, 'isYou via memberId');

  const roomJs = await readFile(path.join(PUBLIC, 'js', 'room.js'), 'utf8');
  assert.ok(!roomJs.includes('button.append(del)'), 'soundboard delete is wrapped not nested');
  assert.match(roomJs, /while \(els\.toasts\.children\.length >= 3\)/, 'toast cap');
  assert.match(roomJs, /file\.size > 2 \* 1024 \* 1024/, 'soundboard client size check');

  const roomCss = await readFile(path.join(PUBLIC, 'css', 'room.css'), 'utf8');
  assert.match(roomCss, /emoji-menu-in/, 'emoji v11 animation');
  assert.match(roomCss, /prefers-reduced-motion/, 'reduced motion respected');
  assert.match(roomCss, /max-height: min\(280px/, 'reaction menu height capped');
  assert.match(roomCss, /\.toast\.is-error \{[^}]*color-danger/, 'distinct error toast');

  const serverCss = await readFile(path.join(PUBLIC, 'css', 'server.css'), 'utf8');
  assert.match(serverCss, /\.server-channel-row/, 'channel row layout');
});

test('libraries: mic DSP wired + PING OP honest docs + changelogs bilingual', async () => {
  const liveEnhancer = await readFile(path.join(PUBLIC, 'js', 'room', 'mic-enhancer.js'), 'utf8');
  assert.match(liveEnhancer, /if \(cfg\.bypass\) return/, 'bypass honored live');
  assert.match(liveEnhancer, /workletNode\.connect\(lowpass\)/, 'worklet is in the chain');
  assert.match(liveEnhancer, /setStrength/, 'live strength API');
  assert.match(liveEnhancer, /ownedCtx/, 'shared context ownership tracked for dispose');

  const canonical = await readFile(path.join(ROOT, 'mic', 'mic_ev1', 'src', 'mic-enhancer.js'), 'utf8');
  assert.match(canonical, /gate\?\.update\?\.\(level\)/, 'canonical gate wired');
  assert.match(canonical, /agc\.update\(level\)/, 'canonical AGC wired');

  const micChangelog = await readFile(path.join(ROOT, 'mic', 'CHANGELOG.md'), 'utf8');
  assert.doesNotMatch(micChangelog, /نص\)\)/, 'garbled line fixed');
  assert.doesNotMatch(micChangelog, /\[mic_ev1\.1\] — مخطط/, 'duplicate ev1.1 heading removed');

  const mainLog = JSON.parse(await readFile(path.join(PUBLIC, 'libraries-changelog.json'), 'utf8'));
  assert.ok(mainLog.entries.some((e) => e.library === 'mic' && e.version === 'ev1.1-fix'));
  assert.ok(mainLog.entries.some((e) => e.library === 'ping-op' && e.version === '1.0.1'));
  for (const e of mainLog.entries) {
    assert.ok(e.titleEn && e.titleAr);
    assert.ok(e.pointsEn.length && e.pointsAr.length);
  }
});
