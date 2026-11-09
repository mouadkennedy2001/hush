import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

import express from 'express';
import multer from 'multer';
import { Server as SocketServer } from 'socket.io';

import { RoomManager, formatCode, isValidCode, normalizeCode } from './rooms.js';
import { ServerManager, cleanServerName, cleanChannelName, cleanChannelType, cleanEmojiId, cleanDeviceId, cleanInviteCode, isValidServerId, isValidChannelId } from './servers.js';
import { attachRealtime } from './realtime.js';
import { SessionStore, sessions as defaultSessionsStore } from './sessions.js';
import { createPingServer } from '../PING OP/src/server.js';
import { isGiphyConfigured, searchGifs, trendingGifs, randomGif, getGifById } from './giphy.js';
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_EXTENSIONS,
  UPLOAD_MIME_TYPES,
  SOUNDBOARD_IDS,
  CUSTOM_EMOJI_IDS,
  CUSTOM_EMOJI_SET,
  MAX_CUSTOM_SOUNDS_PER_ROOM,
  MAX_BOARD_AUDIO_BYTES,
  BOARD_AUDIO_EXTENSIONS,
  BOARD_AUDIO_MIME_TYPES
} from './constants.js';
import { normalizeCustomSound } from './rooms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function rateLimiter({ windowMs, max, sweepMs = Math.max(windowMs * 4, 60_000) }) {
  const hits = new Map();
  let nextSweep = Date.now() + sweepMs;
  return (req, res, next) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return res.status(429).json({ error: 'rate-limited' });
    }
    recent.push(now);
    hits.set(key, recent);

    // Drop stale buckets periodically so a long-running process does not keep
    // one array per IP address forever.
    if (now >= nextSweep) {
      nextSweep = now + sweepMs;
      for (const [entryKey, times] of hits) {
        const fresh = times.filter((time) => now - time < windowMs);
        if (fresh.length) hits.set(entryKey, fresh);
        else hits.delete(entryKey);
      }
    }

    next();
  };
}

function cleanUploadName(name) {
  return String(name ?? 'File')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120) || 'File';
}

export async function createHushServer({
  port = Number(process.env.PORT) || 3000,
  host = process.env.HOST || '0.0.0.0',
  publicDir = path.join(ROOT, 'public'),
  dataDir = process.env.DATA_DIR || path.join(ROOT, 'data'),
  uploadsDir = process.env.UPLOADS_DIR || path.join(ROOT, 'uploads'),
  idleTtlMs,
  historyTtlMs,
  log = console
} = {}) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(uploadsDir, { recursive: true });

  const rooms = new RoomManager({ dataDir, uploadsDir, idleTtlMs, historyTtlMs, log });
  await rooms.init();
  // Servers are a SEPARATE system from rooms: own manager, own storage,
  // own chat files. No room codes involved.
  const servers = new ServerManager({ dataDir, uploadsDir, log });
  await servers.init();
  // Full sessions (A1): opaque tokens bound to deviceId+serverId. Tests may
  // inject their own store; production uses a process-global store.
  const sessions = defaultSessionsStore;
  // Helper: a valid token always wins over a client-supplied deviceId.
  const reqDeviceId = (req, fallbackDeviceId = null, serverId = null) => {
    const token = req.headers?.['x-session-token'] || req.body?.sessionToken || req.query?.sessionToken || '';
    const { deviceId, via } = sessions.resolve({ sessionToken: token, deviceId: fallbackDeviceId, serverId });
    return via === 'none' ? '' : deviceId;
  };
  const attachParams = { rooms, servers, sessions };

  const app = express();
  const server = http.createServer(app);
  // PING OP v1.0 hardening: TCP_NODELAY (setNoDelay) + short keep-alive (see PING OP/src/server.js).
  const pingOpServer = createPingServer();
  pingOpServer.applyHardening(server);
  const io = new SocketServer(server, {
    maxHttpBufferSize: 256_000,
    // Faster dead-peer detection = quicker reconnect + fresher ping.
    pingInterval: 5000,
    pingTimeout: 8000,
    transports: ['websocket', 'polling'],
    cors: { origin: false }
  });

  // PING OP socket echo lives in the library; realtime owns everything else.
  pingOpServer.attach(io);
  attachRealtime(io, attachParams);

  app.disable('x-powered-by');
  // H3: only trust X-Forwarded-For when we know we are behind a proxy.
  // Default 0 = use socket/req IP directly (spoof-proof for direct exposure).
  // Behind a known proxy set HUSH_TRUST_PROXY=1.
  app.set('trust proxy', process.env.HUSH_TRUST_PROXY === '1' ? 1 : 0);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Origin-Agent-Cluster', '?1');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader(
      'Permissions-Policy',
      'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()'
    );
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        // v12: https: images ONLY (no script). This is the error/-folder
        // fix: the old `img-src 'self' data: blob:` blocked every external
        // GIF (Giphy/Tenor/direct .gif), so chat showed a tiny broken
        // "GIF" icon. An <img> cannot execute script and object-src stays
        // 'none', so allowing https images does not open XSS — scripts
        // still come only from 'self'.
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob:",
        "connect-src 'self' ws: wss:",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'"
      ].join('; ')
    );
    next();
  });

  // Global IP rate limit (light) to blunt HTTP floods.
  app.use(rateLimiter({ windowMs: 60_000, max: 300 }));

  app.use(express.json({ limit: '64kb' }));

  // Same-origin guard for API writes (Origin header when present must match Host).
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.headers.origin;
    if (origin) {
      try {
        const url = new URL(origin);
        if (url.host !== req.headers.host) return res.status(403).json({ error: 'forbidden-origin' });
      } catch {
        return res.status(403).json({ error: 'forbidden-origin' });
      }
    }
    next();
  });

  // PING OP v1.0 HTTP probe (pingOpServer keeps no-store + adds X-Ping-Op).
  app.get('/api/ping', (req, res) => pingOpServer.httpHandler(req, res));

  // PING OP 1.1: clients report aggregated stats so /api/health is real.
  // Numbers only, clamped — never trust client strings (stored-XSS guard).
  const pingStatsLimit = rateLimiter({ windowMs: 60_000, max: 30 });
  app.post('/api/ping/stats', pingStatsLimit, (req, res) => {
    try { pingOpServer.reportStats(req.body || {}); } catch { /* ignore */ }
    res.json({ ok: true });
  });

  /* -------- Giphy v1.0 (server-only API key, never in browser code) -------- */
  // The browser only ever sees /api/gif/* + media.giphy.com URLs.
  // Rate limits protect the key quota; validation happens in src/giphy.js.
  const gifSearchLimit = rateLimiter({ windowMs: 60_000, max: 30 });
  const gifReadLimit = rateLimiter({ windowMs: 60_000, max: 60 });
  app.get('/api/gif/status', gifReadLimit, (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ ok: true, configured: isGiphyConfigured() });
  });
  app.get('/api/gif/search', gifSearchLimit, async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'public, max-age=30');
      res.json(await searchGifs({
        q: req.query.q, limit: req.query.limit, offset: req.query.offset,
        rating: req.query.rating, lang: req.query.lang
      }));
    } catch (error) { next(error); }
  });
  app.get('/api/gif/trending', gifReadLimit, async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'public, max-age=30');
      res.json(await trendingGifs({ limit: req.query.limit, offset: req.query.offset, rating: req.query.rating }));
    } catch (error) { next(error); }
  });
  app.get('/api/gif/random', gifReadLimit, async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await randomGif({ tag: req.query.tag }));
    } catch (error) { next(error); }
  });
  app.get('/api/gif/:id', gifReadLimit, async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json(await getGifById(req.params.id));
    } catch (error) { next(error); }
  });

  app.get('/api/changelog', async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'public, max-age=300');
      const raw = await fs.readFile(path.join(publicDir, 'changelog.json'), 'utf8');
      res.type('application/json').send(raw);
    } catch {
      res.json({ version: '1.0.0', entries: [] });
    }
  });

  // Dedicated libraries log (mic + PING OP), bilingual via the JSON itself.
  app.get('/api/libraries-changelog', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'public, max-age=300');
      const raw = await fs.readFile(path.join(publicDir, 'libraries-changelog.json'), 'utf8');
      res.type('application/json').send(raw);
    } catch {
      res.json({ version: 'libraries-1.0.0', entries: [] });
    }
  });

  app.get('/api/sounds', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({
      sounds: ['message', 'mention', 'join', 'leave', 'error', 'kick', 'ban', 'success', 'click', 'blip', 'hand', 'knock', 'camera', 'share', 'reaction', 'pop', 'welcome', 'goodbye', 'coin', 'levelup', 'warning', 'achievement', 'whoosh', 'chime', 'bubble', 'slide', 'dingdong', 'echo']
    });
  });

  app.get('/api/soundboard', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({ sounds: SOUNDBOARD_IDS, emojis: CUSTOM_EMOJI_IDS });
  });

  app.get('/api/health', async (req, res, next) => {
    try {
      res.json({
        ok: true,
        rooms: await rooms.currentRoomCount(),
        uptime: Math.round(process.uptime()),
        // PING OP aggregate (server-side echo picture) for ops dashboards.
        ping: pingOpServer.getStats()
      });
    } catch (error) {
      next(error);
    }
  });

  const createRoomLimit = rateLimiter({ windowMs: 60_000, max: 12 });
  app.post('/api/rooms', createRoomLimit, async (req, res, next) => {
    try {
      const code = await rooms.generateUniqueCode();
      await rooms.getOrCreate(code);
      res.status(201).json({
        code,
        formatted: formatCode(code),
        url: `/r/${code}`
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/rooms/:code', async (req, res, next) => {
    try {
      const code = normalizeCode(req.params.code);
      if (!isValidCode(code)) return res.status(400).json({ error: 'invalid-code' });
      const exists = await rooms.codeExists(code);
      res.json({ code, formatted: formatCode(code), exists });
    } catch (error) {
      next(error);
    }
  });

  /* -------- Servers: SEPARATE system from rooms (own chat + voice) -------- */
  const serverLimit = rateLimiter({ windowMs: 60_000, max: 20 });

  app.get('/api/servers', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // A4/C4: unauthenticated enumeration is restricted — only the viewer's
    // own member servers are listed. Without identity: redacted previews.
    const viewer = reqDeviceId(req, req.query?.deviceId, null) || cleanDeviceId(req.query?.deviceId);
    const list = viewer ? servers.listFor(viewer) : [];
    // Back-compat for diagnostics/tests: callers with no identity get the
    // redacted public summaries of nothing (no scraping surface). Old
    // public list behaviour is intentionally removed for privacy.
    res.json({ servers: list.map((s) => servers.publicSummary(s, viewer || null)) });
  });

  app.post('/api/servers', serverLimit, async (req, res, next) => {
    try {
      const name = cleanServerName(req.body?.name);
      const ownerDeviceId = cleanDeviceId(req.body?.ownerDeviceId);
      if (!name || !ownerDeviceId) return res.status(400).json({ error: 'invalid-server' });
      const server = await servers.create({
        name,
        ownerName: String(req.body?.ownerName || 'Guest').slice(0, 32),
        ownerDeviceId,
        iconEmojiId: cleanEmojiId(req.body?.iconEmojiId),
        description: String(req.body?.description || '').slice(0, 140)
      });
      if (!server) return res.status(409).json({ error: 'server-limit' });
      const sessionToken = sessions.issue(ownerDeviceId, server.id);
      res.status(201).json({ server: servers.publicSummary(server, ownerDeviceId), sessionToken });
    } catch (error) { next(error); }
  });

  app.get('/api/servers/:id', (req, res) => {
    const server = servers.get(req.params.id);
    if (!server) return res.status(404).json({ error: 'server-not-found' });
    const viewer = reqDeviceId(req, req.query?.deviceId, server.id) || cleanDeviceId(req.query?.deviceId);
    // Non-members get only a redacted preview (name/counts, no members).
    res.json({ server: servers.publicSummary(server, viewer || null) });
  });

  app.post('/api/servers/:id/join', serverLimit, async (req, res) => {
    const deviceId = reqDeviceId(req, req.body?.deviceId, req.params.id);
    const server = await servers.join(req.params.id, {
      deviceId: req.body?.deviceId, name: req.body?.name, inviteCode: req.body?.inviteCode
    });
    if (!server) {
      const existing = servers.get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'server-not-found' });
      if (deviceId && servers.isBanned(existing, deviceId)) return res.status(403).json({ error: 'banned' });
      return res.status(403).json({ error: 'invite-required' });
    }
    // A1: issue a session token for subsequent privileged calls in this server.
    const joinDevice = cleanDeviceId(req.body?.deviceId) || deviceId;
    const sessionToken = joinDevice ? sessions.issue(joinDevice, server.id) : '';
    res.json({ server: servers.publicSummary(server, joinDevice || null), sessionToken });
  });

  const inviteLimit = rateLimiter({ windowMs: 60_000, max: 20 });
  app.get('/api/servers/invite/:code', inviteLimit, (req, res) => {
    const server = servers.findByInvite(req.params.code);
    if (!server) return res.status(404).json({ error: 'invite-not-found' });
    // The caller proved the invite code. Return a preview without leaking
    // ownerDeviceId/members, but keep the code echoed for the invite UI.
    const preview = servers.publicSummary(server, null);
    res.json({ server: { ...preview, inviteCode: server.inviteCode } });
  });

  app.post('/api/servers/:id/leave', async (req, res) => {
    // A7/H2: leave must evict live sockets, not just mutate the DB.
    const actor = reqDeviceId(req, req.body?.deviceId, req.params.id);
    const ok = await servers.leave(req.params.id, actor || req.body?.deviceId);
    if (!ok) return res.status(400).json({ error: 'leave-failed' });
    sessions.revokeAllForDevice(actor || req.body?.deviceId, req.params.id);
    for (const [, sock] of io.sockets.sockets) {
      if (sock.data.serverId === req.params.id && sock.data.serverDeviceId === (actor || req.body?.deviceId)) {
        try { sock.emit('server:kicked', { by: '' }); } catch { /* ignore */ }
        try { sock.leave(`server:${req.params.id}`); } catch { /* ignore */ }
        try { sock.disconnect(true); } catch { /* ignore */ }
      }
    }
    res.json({ ok: true });
  });

  app.post('/api/servers/:id/regenerate-invite', serverLimit, async (req, res) => {
    const actor = reqDeviceId(req, req.body?.deviceId, req.params.id);
    const server = await servers.regenerateInvite(req.params.id, actor || req.body?.deviceId);
    if (!server) return res.status(403).json({ error: 'not-admin' });
    res.json({ server: servers.publicSummary(server, actor || req.body?.deviceId) });
  });

  app.patch('/api/servers/:id', serverLimit, async (req, res) => {
    const actor = reqDeviceId(req, req.body?.deviceId, req.params.id);
    const updated = await servers.updateSettings(req.params.id, actor || req.body?.deviceId, {
      name: req.body?.name, description: req.body?.description, iconEmojiId: req.body?.iconEmojiId
    });
    if (!updated) {
      const server = servers.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'server-not-found' });
      return res.status(403).json({ error: 'not-admin' });
    }
    io.to(`server:${req.params.id}`).emit('server:channels:updated', { server: servers.broadcastSummary(updated) });
    res.json({ server: servers.publicSummary(updated, actor || req.body?.deviceId) });
  });

  app.post('/api/servers/:id/transfer', serverLimit, async (req, res) => {
    // N1/A16: ownership transfer for orphaned servers.
    const actor = reqDeviceId(req, req.body?.deviceId, req.params.id);
    const updated = await servers.transferOwnership(req.params.id, actor || req.body?.deviceId, req.body?.toDeviceId);
    if (!updated) {
      const server = servers.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'server-not-found' });
      return res.status(403).json({ error: 'not-admin' });
    }
    io.to(`server:${req.params.id}`).emit('server:members:updated', { server: servers.broadcastSummary(updated) });
    res.json({ server: servers.publicSummary(updated, actor || req.body?.deviceId) });
  });

  app.post('/api/servers/:id/kick', serverLimit, async (req, res) => {
    const actor = reqDeviceId(req, req.body?.deviceId, req.params.id);
    const targetDeviceId = cleanDeviceId(req.body?.targetDeviceId);
    const ok = await servers.kick(req.params.id, actor || req.body?.deviceId, targetDeviceId);
    if (!ok) return res.status(403).json({ error: 'not-admin' });
    sessions.revokeAllForDevice(targetDeviceId, req.params.id);
    const server = servers.get(req.params.id);
    // Evict the kicked device's live sockets immediately (REST path used to
    // leave them online until their next action).
    for (const [, sock] of io.sockets.sockets) {
      if (sock.data.serverId === req.params.id && sock.data.serverDeviceId === targetDeviceId) {
        try { sock.emit('server:kicked', { by: '' }); } catch { /* ignore */ }
        try { sock.disconnect(true); } catch { /* ignore */ }
      }
    }
    io.to(`server:${req.params.id}`).emit('server:members:updated', { server: servers.broadcastSummary(server) });
    res.json({ ok: true, server: servers.publicSummary(server, actor || req.body?.deviceId) });
  });

  app.post('/api/servers/:id/ban', serverLimit, async (req, res) => {
    const actor = reqDeviceId(req, req.body?.deviceId, req.params.id);
    const targetDeviceId = cleanDeviceId(req.body?.targetDeviceId);
    const ban = await servers.ban(req.params.id, actor || req.body?.deviceId, targetDeviceId, req.body?.targetName, req.body?.minutes);
    if (!ban) return res.status(403).json({ error: 'not-admin' });
    sessions.revokeAllForDevice(targetDeviceId, req.params.id);
    const server = servers.get(req.params.id);
    for (const [, sock] of io.sockets.sockets) {
      if (sock.data.serverId === req.params.id && sock.data.serverDeviceId === targetDeviceId) {
        try { sock.emit('server:kicked', { by: '' }); } catch { /* ignore */ }
        try { sock.disconnect(true); } catch { /* ignore */ }
      }
    }
    io.to(`server:${req.params.id}`).emit('server:members:updated', { server: servers.broadcastSummary(server) });
    res.json({ ok: true, ban, server: servers.publicSummary(server, actor || req.body?.deviceId) });
  });

  app.post('/api/servers/:id/unban', serverLimit, async (req, res) => {
    const actor = reqDeviceId(req, req.body?.deviceId, req.params.id);
    const ok = await servers.unban(req.params.id, actor || req.body?.deviceId, req.body?.targetDeviceId);
    if (!ok) return res.status(403).json({ error: 'not-admin' });
    res.json({ ok: true });
  });

  app.get('/api/servers/:id/history', async (req, res) => {
    const server = servers.get(req.params.id);
    if (!server) return res.status(404).json({ error: 'server-not-found' });
    const viewer = reqDeviceId(req, req.query?.deviceId, server.id) || cleanDeviceId(req.query?.deviceId);
    if (!viewer || !servers.isMember(server, viewer) || servers.isBanned(server, viewer)) return res.status(403).json({ error: 'not-member' });
    const channelId = String(req.query.channelId || '');
    if (!isValidChannelId(channelId)) return res.status(404).json({ error: 'channel-not-found' });
    const channel = server.channels.find((c) => c.id === channelId);
    if (!channel) return res.status(404).json({ error: 'channel-not-found' });
    const messages = await servers.loadMessages(server.id, channelId);
    res.json({ ok: true, messages });
  });

  app.post('/api/servers/:id/channels', serverLimit, async (req, res) => {
    const name = cleanChannelName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'invalid-channel' });
    const actor = reqDeviceId(req, req.body?.deviceId || req.body?.ownerDeviceId, req.params.id);
    const channel = await servers.addChannel(
      req.params.id,
      { name, type: cleanChannelType(req.body?.type) },
      actor || req.body?.deviceId || req.body?.ownerDeviceId
    );
    if (!channel) {
      const server = servers.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'server-not-found' });
      if (!servers.isOwner(server, actor || req.body?.deviceId || req.body?.ownerDeviceId)) return res.status(403).json({ error: 'not-admin' });
      return res.status(409).json({ error: 'channel-limit' });
    }
    const updated = servers.get(req.params.id);
    io.to(`server:${req.params.id}`).emit('server:channels:updated', { server: servers.broadcastSummary(updated) });
    res.status(201).json({ channel, server: servers.publicSummary(updated, actor || req.body?.deviceId || req.body?.ownerDeviceId) });
  });

  app.patch('/api/servers/:id/channels/:channelId', serverLimit, async (req, res) => {
    if (!isValidChannelId(req.params.channelId)) return res.status(404).json({ error: 'channel-not-found' });
    const actor = reqDeviceId(req, req.body?.deviceId, req.params.id);
    const channel = await servers.renameChannel(req.params.id, req.params.channelId, req.body?.name, actor || req.body?.deviceId);
    if (!channel) {
      const server = servers.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'server-not-found' });
      return res.status(403).json({ error: 'not-admin' });
    }
    const updated = servers.get(req.params.id);
    io.to(`server:${req.params.id}`).emit('server:channels:updated', { server: servers.broadcastSummary(updated) });
    res.json({ channel, server: servers.publicSummary(updated, actor || req.body?.deviceId) });
  });

  const channelDeleteLimit = rateLimiter({ windowMs: 60_000, max: 20 });
  app.delete('/api/servers/:id/channels/:channelId', channelDeleteLimit, async (req, res) => {
    if (!isValidChannelId(req.params.channelId)) return res.status(404).json({ error: 'channel-not-found' });
    const actor = reqDeviceId(req, req.body?.deviceId, req.params.id);
    const removed = await servers.deleteChannel(req.params.id, req.params.channelId, actor || req.body?.deviceId);
    if (!removed) {
      const server = servers.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'server-not-found' });
      if (!servers.isOwner(server, actor || req.body?.deviceId)) return res.status(403).json({ error: 'not-admin' });
      return res.status(400).json({ error: 'channel-not-found' });
    }
    const updated = servers.get(req.params.id);
    io.to(`server:${req.params.id}`).emit('server:channels:updated', { server: servers.broadcastSummary(updated) });
    res.json({ ok: true });
  });

  const serverDeleteLimit = rateLimiter({ windowMs: 60_000, max: 10 });
  app.delete('/api/servers/:id', serverDeleteLimit, async (req, res) => {
    const actor = reqDeviceId(req, req.body?.deviceId, req.params.id);
    const removed = await servers.deleteServer(req.params.id, actor || req.body?.deviceId);
    if (!removed) {
      const server = servers.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'server-not-found' });
      return res.status(403).json({ error: 'not-admin' });
    }
    sessions.revokeAllForServer(req.params.id);
    // H2: evict all live sockets on delete — REST leave/delete used to leak.
    for (const [, sock] of io.sockets.sockets) {
      if (sock.data.serverId === req.params.id) {
        try { sock.leave(`server:${req.params.id}`); } catch { /* ignore */ }
        try { sock.disconnect(true); } catch { /* ignore */ }
      }
    }
    try { await rooms?.stopCleanup?.(); } catch { /* ignore — no-op for servers */ }
    io.to(`server:${req.params.id}`).emit('server:deleted', { id: req.params.id });
    res.json({ ok: true });
  });

  // Server chat uploads: uploads/server-<id>/<channelId>/ (separate from rooms).
  const serverUploadLimit = rateLimiter({ windowMs: 60_000, max: 30 });
  const serverUpload = multer({
    storage: multer.diskStorage({
      destination(req, file, callback) {
        try {
          // channelId came from the query before multer validation:
          // only a syntactically valid id reaches the path (no traversal).
          const safeChannel = isValidChannelId(req.channelId) ? req.channelId : 'invalid-channel';
          const directory = path.join(uploadsDir, `server-${req.serverId}`, safeChannel);
          mkdirSync(directory, { recursive: true });
          callback(null, directory);
        } catch (error) { callback(error); }
      },
      filename(req, file, callback) {
        callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
      }
    }),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter(req, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase();
      const lowerName = String(file.originalname || '').toLowerCase();
      const dangerous = /\.(exe|sh|bat|js|html?|svg|php|jsp|py)$/.test(lowerName);
      if (dangerous || lowerName.includes('.exe') || lowerName.includes('.sh')) {
        const error = new Error('unsupported-file-type');
        error.status = 415;
        return callback(error);
      }
      if (!UPLOAD_EXTENSIONS.has(extension)) {
        const error = new Error('unsupported-file-type');
        error.status = 415;
        return callback(error);
      }
      // Pasted/screenshot images sometimes report a generic mime.
      const mime = String(file.mimetype || '').toLowerCase();
      const imageExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'].includes(extension);
      if (!UPLOAD_MIME_TYPES.has(mime) && !(imageExt && mime.startsWith('image/'))) {
        const error = new Error('unsupported-file-type');
        error.status = 415;
        return callback(error);
      }
      callback(null, true);
    }
  });

  // N4/A9/H4: per-server upload quota + session. Quota prevents disk DoS.
  // Cache dir sizes briefly so every upload does not re-walk the tree.
  const UPLOAD_QUOTA_BYTES = Number(process.env.UPLOAD_QUOTA_BYTES) || 512 * 1024 * 1024;
  const quotaCache = new Map(); // dir -> { at, bytes }
  async function dirSizeBytes(dir) {
    const cached = quotaCache.get(dir);
    if (cached && Date.now() - cached.at < 5000) return cached.bytes;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      let total = 0;
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) total += await dirSizeBytes(p);
        else if (e.isFile()) { try { total += (await fs.stat(p)).size; } catch { /* ignore */ } }
      }
      quotaCache.set(dir, { at: Date.now(), bytes: total });
      return total;
    } catch { return 0; }
  }

  app.post('/api/servers/:id/upload', serverUploadLimit, async (req, res, next) => {
    const serverId = String(req.params.id || '');
    if (!isValidServerId(serverId)) { req.resume(); return res.status(404).json({ error: 'server-not-found' }); }
    const server = servers.get(serverId);
    if (!server) { req.resume(); return res.status(404).json({ error: 'server-not-found' }); }
    // Auth from the query (deviceId is in the query so it is available
    // BEFORE multer parses the multipart body). channelId is read AFTER
    // multer — req.body is empty before that, so reading it here always
    // failed (the "upload fails" bug).
    const deviceId = reqDeviceId(req, req.query?.deviceId, serverId) || cleanDeviceId(req.query?.deviceId);
    if (!deviceId || !servers.isMember(server, deviceId) || servers.isBanned(server, deviceId)) {
      req.resume();
      return res.status(403).json({ error: 'not-member' });
    }
    req.serverId = req.params.id;
    // Destination needs a channel dir: multer runs before we can read the
    // multipart channelId, so use the query channelId for the directory.
    req.channelId = String(req.query?.channelId || '');
    serverUpload.single('file')(req, res, async (error) => {
      if (error) return next(error);
      const cleanup = async () => { try { if (req.file) await fs.unlink(req.file.path); } catch { /* ignore */ } };
      const channelId = String(req.query?.channelId || req.body?.channelId || '');
      const bodyChannelId = String(req.body?.channelId || '');
      // Query and body must agree (client sends both); a mismatch means the
      // file landed in a different channel directory than claimed.
      if (bodyChannelId && req.query?.channelId && bodyChannelId !== req.query.channelId) {
        await cleanup();
        return res.status(404).json({ error: 'channel-not-found' });
      }
      if (!isValidChannelId(channelId)) { await cleanup(); return res.status(404).json({ error: 'channel-not-found' }); }
      const channel = server.channels.find((c) => c.id === channelId && c.type === 'text');
      if (!channel) { await cleanup(); return res.status(404).json({ error: 'channel-not-found' }); }
      if (!req.file) return res.status(400).json({ error: 'missing-file' });
      // Quota: refuse if this server already exceeds its storage budget.
      const used = await dirSizeBytes(path.join(uploadsDir, `server-${serverId}`));
      if (used >= UPLOAD_QUOTA_BYTES) { await cleanup(); return res.status(413).json({ error: 'upload-quota-exceeded' }); }
      res.status(201).json({
        url: `/uploads/server-${req.params.id}/${channelId}/${req.file.filename}`,
        name: cleanUploadName(req.file.originalname),
        size: req.file.size,
        mime: req.file.mimetype
      });
    });
  });

  const uploadLimit = rateLimiter({ windowMs: 60_000, max: 30 });
  const upload = multer({
    storage: multer.diskStorage({
      destination(req, file, callback) {
        try {
          const directory = path.join(uploadsDir, req.roomCode);
          mkdirSync(directory, { recursive: true });
          callback(null, directory);
        } catch (error) {
          callback(error);
        }
      },
      filename(req, file, callback) {
        const extension = path.extname(file.originalname).toLowerCase();
        callback(null, `${randomUUID()}${extension}`);
      }
    }),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter(req, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase();
      // Block double extensions like photo.jpg.exe and script-y names.
      const lowerName = String(file.originalname || '').toLowerCase();
      const dangerous = /\.(exe|sh|bat|js|html?|svg|php|jsp|py)$/.test(lowerName);
      if (dangerous || lowerName.includes('.exe') || lowerName.includes('.sh')) {
        const error = new Error('unsupported-file-type');
        error.status = 415;
        return callback(error);
      }
      if (!UPLOAD_EXTENSIONS.has(extension) || !UPLOAD_MIME_TYPES.has(file.mimetype)) {
        const error = new Error('unsupported-file-type');
        error.status = 415;
        return callback(error);
      }
      callback(null, true);
    }
  });

  app.post('/api/rooms/:code/upload', uploadLimit, async (req, res, next) => {
    const code = normalizeCode(req.params.code);
    if (!isValidCode(code)) {
      req.resume();
      return res.status(400).json({ error: 'invalid-code' });
    }
    if (!(await rooms.codeExists(code))) {
      req.resume();
      return res.status(404).json({ error: 'room-not-found' });
    }
    req.roomCode = code;

    upload.single('file')(req, res, (error) => {
      if (error) return next(error);
      if (!req.file) return res.status(400).json({ error: 'missing-file' });
      res.status(201).json({
        url: `/uploads/${code}/${req.file.filename}`,
        name: cleanUploadName(req.file.originalname),
        size: req.file.size,
        mime: req.file.mimetype
      });
    });
  });

  // Custom room soundboard: upload an audio clip for THIS room only.
  // The file lives in uploads/<code>/board/ and is deleted completely
  // when the last person leaves the room (see realtime leave()) or when
  // the idle room is cleaned up. Cap: 12 sounds, 2 MB each, audio only.
  const boardUpload = multer({
    storage: multer.diskStorage({
      destination(req, file, callback) {
        try {
          const directory = path.join(uploadsDir, req.roomCode, 'board');
          mkdirSync(directory, { recursive: true });
          callback(null, directory);
        } catch (error) { callback(error); }
      },
      filename(req, file, callback) {
        callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
      }
    }),
    limits: { fileSize: MAX_BOARD_AUDIO_BYTES, files: 1 },
    fileFilter(req, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase();
      const lowerName = String(file.originalname || '').toLowerCase();
      const dangerous = /\.(exe|sh|bat|js|html?|svg|php|jsp|py)$/.test(lowerName);
      const mimeOk = BOARD_AUDIO_MIME_TYPES.has(file.mimetype) || String(file.mimetype || '').startsWith('audio/')
        || String(file.mimetype || '').startsWith('video/webm');
      if (dangerous || !BOARD_AUDIO_EXTENSIONS.has(extension) || !mimeOk) {
        const error = new Error('unsupported-file-type');
        error.status = 415;
        return callback(error);
      }
      callback(null, true);
    }
  });

  app.post('/api/rooms/:code/soundboard', uploadLimit, async (req, res, next) => {
    const code = normalizeCode(req.params.code);
    if (!isValidCode(code)) { req.resume(); return res.status(400).json({ error: 'invalid-code' }); }
    if (!(await rooms.codeExists(code))) { req.resume(); return res.status(404).json({ error: 'room-not-found' }); }
    req.roomCode = code;
    boardUpload.single('file')(req, res, async (error) => {
      if (error) return next(error);
      if (!req.file) return res.status(400).json({ error: 'missing-file' });
      try {
        const room = await rooms.getOrCreate(code);
        if ((room.customSounds || []).length >= MAX_CUSTOM_SOUNDS_PER_ROOM) {
          try { await fs.unlink(req.file.path); } catch { /* ignore */ }
          return res.status(409).json({ error: 'board-full' });
        }
        const emojiId = CUSTOM_EMOJI_SET.has(String(req.body?.emojiId)) ? String(req.body.emojiId) : 'star';
        // A25: addedById is display/permission data — only accept it if it
        // is a live participant id, otherwise the upload is anonymous
        // (delete permission then falls back to host-only).
        const claimedId = String(req.body?.addedById || '');
        const claimedBy = cleanUploadName(req.body?.addedBy || '').slice(0, 32);
        const live = room.participants?.get(claimedId);
        const sound = normalizeCustomSound({
          id: randomUUID(),
          name: cleanUploadName(req.body?.name || req.file.originalname).slice(0, 40),
          emojiId,
          url: `/uploads/${code}/board/${req.file.filename}`,
          size: req.file.size,
          mime: req.file.mimetype,
          addedById: live ? claimedId : '',
          addedBy: live ? (live.name || claimedBy) : '',
          createdAt: Date.now()
        }, code);
        if (!sound) {
          try { await fs.unlink(req.file.path); } catch { /* ignore */ }
          return res.status(400).json({ error: 'invalid-sound' });
        }
        const saved = await rooms.addCustomSound(room, sound);
        if (!saved) {
          try { await fs.unlink(req.file.path); } catch { /* ignore */ }
          return res.status(409).json({ error: 'board-full' });
        }
        io.to(`room:${code}`).emit('soundboard:added', { sound: saved });
        res.status(201).json({ sound: saved });
      } catch (err) { next(err); }
    });
  });

  app.get('/r/:code', (req, res) => {
    res.sendFile(path.join(publicDir, 'room.html'));
  });

  // Servers are a separate page/system from rooms.
  app.get('/s/:id', (req, res) => {
    res.sendFile(path.join(publicDir, 'server.html'));
  });

  app.use(
    '/uploads',
    express.static(uploadsDir, {
      fallthrough: false,
      maxAge: '1h',
      setHeaders(res) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'"
        );
      }
    })
  );

  app.use(
    express.static(publicDir, {
      etag: true,
      // HTML never caches (always fresh room shell). JS/CSS revalidate
      // quickly via ETag (304, no re-download) instead of full refetch
      // on every reload — less bandwidth, faster joins, lower ping noise.
      setHeaders(res, filePath) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (/\.html$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (/\.(?:js|css)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
        } else if (/\.(?:wav|svg|png|ico)$/i.test(filePath)) {
          // v12.3: emoji/sticker assets are requested with a cache-busting
          // version (?v=twemoji-1), so immutable is safe for them. Every
          // other binary revalidates hourly instead of serving stale
          // files after an update (the "emojis didn't change" bug).
          const isVersionedAsset = /[/\\](?:emoji|sticker)[/\\]/i.test(filePath);
          res.setHeader('Cache-Control', isVersionedAsset ? 'public, max-age=86400, immutable' : 'public, max-age=3600, must-revalidate');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
      }
    })
  );

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'not-found' });
    }
    return res.status(404).sendFile(path.join(publicDir, '404.html'));
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.name === 'MulterError') {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: error.code.toLowerCase() });
    }
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    log.error?.('Unhandled request error', error);
    return res.status(500).json({ error: 'internal-error' });
  });

  let started = false;
  let cleanupStarted = false;

  return {
    app,
    server,
    io,
    rooms,
    servers,
    config: { publicDir, dataDir, uploadsDir },
    async start(listenPort = port, listenHost = host) {
      if (started) return server.address();
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(listenPort, listenHost);
      });
      if (!cleanupStarted) {
        rooms.startCleanup();
        cleanupStarted = true;
      }
      started = true;
      return server.address();
    },
    async stop() {
      rooms.stopCleanup();
      cleanupStarted = false;
      if (started) {
        // io.close() already closes the HTTP server; never wait forever.
        const withTimeout = (promise, ms) =>
          Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);
        await withTimeout(
          new Promise((resolve) => {
            try { io.close(() => resolve()); } catch { resolve(); }
          }),
          5000
        );
        if (server.listening) {
          await withTimeout(
            new Promise((resolve) => server.close(() => resolve())),
            5000
          );
        }
      }
      started = false;
    }
  };
}
