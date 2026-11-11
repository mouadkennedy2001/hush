import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanGiphyQuery, cleanGiphyId, cleanRating, cleanLang, cleanLimit, cleanOffset,
  isGiphyMediaUrl, normalizeGiphyGif, isGiphyConfigured, GIPHY_VERSION
} from '../src/giphy.js';
import { createPingOp, sanitizeStatsReport } from '../PING OP/src/ping-op.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

test('giphy server module: version, config, and input cleaning', () => {
  assert.equal(GIPHY_VERSION, '1.0.0');
  assert.equal(typeof isGiphyConfigured(), 'boolean');
  assert.equal(cleanGiphyQuery('  hello   world  '), 'hello world');
  assert.equal(cleanGiphyQuery('x'.repeat(200)).length, 80);
  assert.equal(cleanGiphyId('AbC123'), 'AbC123');
  assert.equal(cleanGiphyId('../etc/passwd'), '');
  assert.equal(cleanGiphyId(''), '');
  assert.equal(cleanRating('R'), 'r');
  assert.equal(cleanRating('xxx'), 'pg-13');
  assert.equal(cleanLang('AR'), 'ar');
  assert.equal(cleanLang('not-a-lang!!'), 'en');
  assert.equal(cleanLimit(999), 24);
  assert.equal(cleanLimit(0), 1);
  assert.equal(cleanLimit('abc'), 12);
  assert.equal(cleanOffset(-5), 0);
  assert.equal(cleanOffset(9999), 200);
});

test('giphy media URLs: only *.giphy.com https, no credentials', () => {
  assert.equal(isGiphyMediaUrl('https://media.giphy.com/media/abc/giphy.gif'), true);
  assert.equal(isGiphyMediaUrl('https://i.giphy.com/media/abc/giphy.gif'), true);
  assert.equal(isGiphyMediaUrl('https://media.giphy.com.evil.com/x.gif'), false);
  assert.equal(isGiphyMediaUrl('http://media.giphy.com/media/abc/giphy.gif'), false);
  assert.equal(isGiphyMediaUrl('https://user:pass@media.giphy.com/x.gif'), false);
  assert.equal(isGiphyMediaUrl('javascript:alert(1)'), false);
  assert.equal(isGiphyMediaUrl(''), false);
});

test('normalizeGiphyGif drops poisoned upstreams and bad ids', () => {
  const good = normalizeGiphyGif({
    id: 'abc123', title: 'Cat GIF', rating: 'g',
    images: {
      original: { url: 'https://media.giphy.com/media/abc123/giphy.gif', width: '480', height: '270', size: '1234' },
      fixed_width: { url: 'https://media.giphy.com/media/abc123/200w.gif', width: '200', height: '112', size: '100' }
    }
  });
  assert.equal(good.id, 'abc123');
  assert.equal(good.url, 'https://media.giphy.com/media/abc123/giphy.gif');
  assert.equal(good.preview, 'https://media.giphy.com/media/abc123/200w.gif');
  assert.equal(good.width, 480);
  assert.equal(normalizeGiphyGif({ id: '../bad', images: { original: { url: 'https://media.giphy.com/media/x/giphy.gif' } } }), null);
  assert.equal(normalizeGiphyGif({ id: 'abc123', images: { original: { url: 'https://evil.example/x.gif' } } }), null);
  assert.equal(normalizeGiphyGif(null), null);
});

test('giphy API key is server-only: never in public/ browser code', async () => {
  const walk = async (dir) => {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...await walk(p));
      else if (/\.(js|html|json|css)$/.test(entry.name)) out.push(p);
    }
    return out;
  };
  for (const file of await walk(PUBLIC)) {
    const text = await readFile(file, 'utf8');
    // Never embed the real key (or its env name) in browser code — and
    // never write the key itself into this test file either.
    assert.doesNotMatch(text, /GIPHY_API_KEY|api_key=/, `${file} must not contain the Giphy key`);
  }
  const giphyServer = await readFile(path.join(ROOT, 'src', 'giphy.js'), 'utf8');
  assert.match(giphyServer, /process\.env\.GIPHY_API_KEY/, 'key from env');
  assert.match(giphyServer, /api\.giphy\.com/, 'fixed upstream (no SSRF)');
  // No 32-char alphanumeric secret is hardcoded in the server module:
  // the key is only ever read from env/.env at runtime.
  assert.doesNotMatch(giphyServer, /['"][A-Za-z0-9]{32}['"]/, 'key not hardcoded in source');
  const envExample = await readFile(path.join(ROOT, '.env.example'), 'utf8');
  assert.doesNotMatch(envExample, /GIPHY_API_KEY=\S+/, '.env.example has no real key');
  const gitignore = await readFile(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.env$/m, '.env is gitignored');
});

test('error/ fix: CSP allows https images (GIFs) but scripts stay self-only', async () => {
  const app = await readFile(path.join(ROOT, 'src', 'app.js'), 'utf8');
  assert.match(app, /img-src 'self' data: blob: https:/, 'https images allowed — external GIFs render');
  assert.match(app, /script-src 'self'/, 'scripts still self-only');
  assert.match(app, /object-src 'none'/, 'no embedded objects');
  assert.match(app, /\/api\/gif\/search/, 'giphy search route');
  assert.match(app, /\/api\/gif\/trending/, 'giphy trending route');
  assert.match(app, /\/api\/gif\/random/, 'giphy random route');
  assert.match(app, /\/api\/gif\/status/, 'giphy status route');
  const emoji = await readFile(path.join(PUBLIC, 'js', 'emoji.js'), 'utf8');
  assert.match(emoji, /gif-broken/, 'failed GIF fallback, not a broken icon');
  assert.match(emoji, /\.giphy\.com/, 'giphy media hosts accepted');
});

test('custom stickers: IndexedDB-first, upload-from-store, SVG blocked', async () => {
  const store = await readFile(path.join(PUBLIC, 'js', 'custom-stickers.js'), 'utf8');
  assert.match(store, /indexedDB/, 'IndexedDB primary store');
  assert.match(store, /localStorage/, 'localStorage fallback');
  assert.match(store, /CUSTOM_STICKER_MAX_COUNT = 30/, 'count cap');
  assert.match(store, /CUSTOM_STICKER_MAX_BYTES = 2 \* 1024 \* 1024/, 'per-sticker size cap');
  assert.match(store, /image\/png/, 'raster types only');
  assert.doesNotMatch(store, /image\/svg/, 'SVG is not an allowed sticker type');
  assert.match(store, /getCustomStickerBlob/, 'upload reads Blob back from the store');
  const panel = await readFile(path.join(PUBLIC, 'js', 'gif-panel.js'), 'utf8');
  assert.match(panel, /openStickerCreator/, 'creator dialog shared');
  assert.match(panel, /onSendCustomSticker/, 'send uploads from IndexedDB');
  const room = await readFile(path.join(PUBLIC, 'js', 'room.js'), 'utf8');
  assert.match(room, /uploadFile\(file\)/, 'room send reuses existing upload flow');
  const server = await readFile(path.join(PUBLIC, 'js', 'server.js'), 'utf8');
  assert.match(server, /await uploadFile\(file\)/, 'server send reuses existing upload flow');
});

test('PING OP 1.1: trend/health and sanitized client reports', () => {
  const op = createPingOp();
  assert.equal(op.getTrend(), 'stable');
  for (let i = 0; i < 5; i += 1) op.sample(50 + i * 2);
  const health = op.getHealth();
  assert.equal(health.version, '1.5.0');
  assert.ok(['improving', 'worsening', 'stable'].includes(health.trend));
  assert.equal(typeof health.healthy, 'boolean');
  const clean = sanitizeStatsReport({ current: '42', avg: 50, median: 40, jitter: 5, lossRate: 2, score: 90, quality: 'good', samplesCount: 10 });
  assert.equal(clean.current, 42);
  assert.equal(clean.score, 90);
  assert.equal(clean.quality, 'good');
  const evil = sanitizeStatsReport({ current: '<script>alert(1)</script>', score: 9999, quality: 'javascript' });
  assert.equal(evil.current, null);
  assert.equal(evil.score, 100);
  assert.equal(evil.quality, 'offline');
  assert.equal(sanitizeStatsReport(null), null);
  assert.equal(sanitizeStatsReport('nope'), null);
});

test('v12 changelog + libraries log document giphy, mic ev1.2, ping 1.1', async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '15.0.0');
  const changelog = JSON.parse(await readFile(path.join(PUBLIC, 'changelog.json'), 'utf8'));
  assert.equal(changelog.version, '15.0.0');
  const top = changelog.entries[0];
  assert.match(top.titleEn, /v15/, 'latest entry on top');
  assert.ok(changelog.entries.some((e) => /Emojis now actually update/.test(e.titleEn)), 'v12.3 entry still present');
  assert.ok(changelog.entries.some((e) => /GIF \+ Sticker buttons/.test(e.titleEn)), 'v12.1 entry still present');
  assert.ok(changelog.entries.some((e) => /Giphy/.test(e.titleEn)), 'a changelog entry documents Giphy');
  assert.ok(changelog.entries.some((e) => /sticker/i.test(e.titleEn)), 'a changelog entry documents stickers');
  const libs = JSON.parse(await readFile(path.join(PUBLIC, 'libraries-changelog.json'), 'utf8'));
  const libraries = new Set(libs.entries.map((e) => e.library));
  assert.ok(libraries.has('giphy'), 'giphy library logged');
  assert.ok(libraries.has('mic'), 'mic library logged');
  assert.ok(libraries.has('ping-op'), 'ping-op library logged');
  for (const e of libs.entries) {
    assert.ok(e.titleEn && e.titleAr, 'bilingual library entries');
    assert.ok(Array.isArray(e.pointsEn) && e.pointsEn.length, 'library points');
  }
});
