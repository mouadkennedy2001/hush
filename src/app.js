import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

import express from 'express';
import multer from 'multer';
import { Server as SocketServer } from 'socket.io';

import { RoomManager, formatCode, isValidCode, normalizeCode } from './rooms.js';
import { attachRealtime } from './realtime.js';
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_EXTENSIONS,
  UPLOAD_MIME_TYPES
} from './constants.js';

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

  const rooms = new RoomManager({ dataDir, idleTtlMs, historyTtlMs, log });
  await rooms.init();

  const app = express();
  const server = http.createServer(app);
  const io = new SocketServer(server, {
    maxHttpBufferSize: 256_000,
    // Faster dead-peer detection = lower perceived ping + quicker reconnect.
    pingInterval: 8000,
    pingTimeout: 12000,
    transports: ['websocket', 'polling'],
    cors: { origin: false }
  });

  attachRealtime(io, { rooms });

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
      sounds: ['message', 'mention', 'join', 'leave', 'error', 'kick', 'ban', 'success', 'click', 'blip']
    });
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

  app.get('/r/:code', (req, res) => {
    res.sendFile(path.join(publicDir, 'room.html'));
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
      setHeaders(res, filePath) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const dynamic = /\.(?:html|js|css)$/i.test(filePath);
        res.setHeader(
          'Cache-Control',
          dynamic ? 'no-cache' : 'public, max-age=3600'
        );
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
