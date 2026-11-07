import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

import express from 'express';
import multer from 'multer';
import { Server as SocketServer } from 'socket.io';

import { RoomManager, formatCode, isValidCode, normalizeCode } from './rooms.js';
import { ServerManager, cleanServerName, cleanChannelName, cleanChannelType, cleanEmojiId, cleanDeviceId, cleanInviteCode } from './servers.js';
import { attachRealtime } from './realtime.js';
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

  const app = express();
  const server = http.createServer(app);
  // Lower latency: TCP_NODELAY kills Nagle's 40ms delayed-ACK stall on
  // small signaling packets; shorter keep-alive timeouts recycle fast.
  server.keepAliveTimeout = 30_000;
  server.headersTimeout = 35_000;
  server.on('connection', (socket) => {
    try { socket.setNoDelay?.(true); } catch { /* ignore */ }
  });
  const io = new SocketServer(server, {
    maxHttpBufferSize: 256_000,
    // Faster dead-peer detection = quicker reconnect + fresher ping.
    pingInterval: 5000,
    pingTimeout: 8000,
    transports: ['websocket', 'polling'],
    cors: { origin: false }
  });

  attachRealtime(io, { rooms, servers });

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

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
        "img-src 'self' data: blob:",
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

  app.get('/api/ping', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.json({ ok: true, time: Date.now() });
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

  app.get('/api/sounds', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({
      sounds: ['message', 'mention', 'join', 'leave', 'error', 'kick', 'ban', 'success', 'click', 'blip', 'hand', 'knock', 'camera', 'share', 'reaction', 'pop']
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
        uptime: Math.round(process.uptime())
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
    res.json({ servers: servers.list().map((s) => servers.publicSummary(s)) });
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
      res.status(201).json({ server: servers.publicSummary(server) });
    } catch (error) { next(error); }
  });

  app.get('/api/servers/:id', (req, res) => {
    const server = servers.get(req.params.id);
    if (!server) return res.status(404).json({ error: 'server-not-found' });
    res.json({ server: servers.publicSummary(server) });
  });

  app.post('/api/servers/:id/join', serverLimit, async (req, res) => {
    const server = await servers.join(req.params.id, {
      deviceId: req.body?.deviceId, name: req.body?.name, inviteCode: req.body?.inviteCode
    });
    if (!server) {
      const existing = servers.get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'server-not-found' });
      return res.status(403).json({ error: 'invite-required' });
    }
    res.json({ server: servers.publicSummary(server) });
  });

  app.get('/api/servers/invite/:code', (req, res) => {
    const server = servers.findByInvite(req.params.code);
    if (!server) return res.status(404).json({ error: 'invite-not-found' });
    res.json({ server: servers.publicSummary(server) });
  });

  app.post('/api/servers/:id/leave', async (req, res) => {
    const ok = await servers.leave(req.params.id, req.body?.deviceId);
    if (!ok) return res.status(400).json({ error: 'leave-failed' });
    res.json({ ok: true });
  });

  app.post('/api/servers/:id/regenerate-invite', serverLimit, async (req, res) => {
    const server = await servers.regenerateInvite(req.params.id, req.body?.deviceId);
    if (!server) return res.status(403).json({ error: 'not-admin' });
    res.json({ server: servers.publicSummary(server) });
  });

  app.post('/api/servers/:id/channels', serverLimit, async (req, res) => {
    const name = cleanChannelName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'invalid-channel' });
    const channel = await servers.addChannel(
      req.params.id,
      { name, type: cleanChannelType(req.body?.type) },
      req.body?.deviceId || req.body?.ownerDeviceId
    );
    if (!channel) {
      const server = servers.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'server-not-found' });
      if (!servers.isMember(server, req.body?.deviceId || req.body?.ownerDeviceId)) return res.status(403).json({ error: 'not-admin' });
      return res.status(409).json({ error: 'channel-limit' });
    }
    io.to(`server:${req.params.id}`).emit('server:channels:updated', { server: servers.publicSummary(servers.get(req.params.id)) });
    res.status(201).json({ channel, server: servers.publicSummary(servers.get(req.params.id)) });
  });

  app.delete('/api/servers/:id/channels/:channelId', async (req, res) => {
    const removed = await servers.deleteChannel(req.params.id, req.params.channelId, req.body?.deviceId);
    if (!removed) {
      const server = servers.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'server-not-found' });
      if (!servers.isOwner(server, req.body?.deviceId)) return res.status(403).json({ error: 'not-admin' });
      return res.status(400).json({ error: 'channel-not-found' });
    }
    io.to(`server:${req.params.id}`).emit('server:channels:updated', { server: servers.publicSummary(servers.get(req.params.id)) });
    res.json({ ok: true });
  });

  app.delete('/api/servers/:id', async (req, res) => {
    const removed = await servers.deleteServer(req.params.id, req.body?.deviceId);
    if (!removed) {
      const server = servers.get(req.params.id);
      if (!server) return res.status(404).json({ error: 'server-not-found' });
      return res.status(403).json({ error: 'not-admin' });
    }
    io.to(`server:${req.params.id}`).emit('server:deleted', { id: req.params.id });
    res.json({ ok: true });
  });

  // Server chat uploads: uploads/server-<id>/<channelId>/ (separate from rooms).
  const serverUploadLimit = rateLimiter({ windowMs: 60_000, max: 30 });
  const serverUpload = multer({
    storage: multer.diskStorage({
      destination(req, file, callback) {
        try {
          const directory = path.join(uploadsDir, `server-${req.serverId}`, req.channelId);
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
      if (dangerous || !UPLOAD_EXTENSIONS.has(extension) || !UPLOAD_MIME_TYPES.has(file.mimetype)) {
        const error = new Error('unsupported-file-type');
        error.status = 415;
        return callback(error);
      }
      callback(null, true);
    }
  });

  app.post('/api/servers/:id/upload', serverUploadLimit, async (req, res, next) => {
    const server = servers.get(req.params.id);
    if (!server) { req.resume(); return res.status(404).json({ error: 'server-not-found' }); }
    const channelId = String(req.body?.channelId || req.query?.channelId || '');
    const channel = server.channels.find((c) => c.id === channelId && c.type === 'text');
    if (!channel) { req.resume(); return res.status(404).json({ error: 'channel-not-found' }); }
    req.serverId = req.params.id;
    req.channelId = channelId;
    serverUpload.single('file')(req, res, (error) => {
      if (error) return next(error);
      if (!req.file) return res.status(400).json({ error: 'missing-file' });
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
        const sound = normalizeCustomSound({
          id: randomUUID(),
          name: cleanUploadName(req.body?.name || req.file.originalname).slice(0, 40),
          emojiId,
          url: `/uploads/${code}/board/${req.file.filename}`,
          size: req.file.size,
          mime: req.file.mimetype,
          addedById: String(req.body?.addedById || ''),
          addedBy: cleanUploadName(req.body?.addedBy || '').slice(0, 32),
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
          res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
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
