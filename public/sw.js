/* Hush service worker — installable app shell with an offline fallback.
   Strategy: network-first for everything same-origin, cached copy as the
   fallback when the network is gone. API, uploads and Socket.IO traffic
   is never cached. Bump CACHE_VERSION when the shell changes. */
const CACHE_VERSION = 'hush-shell-v16';
const SHELL = [
  '/',
  '/index.html',
  '/css/tokens.css',
  '/css/base.css',
  '/css/landing.css',
  '/css/room.css',
  '/css/server.css',
  '/css/feedback.css',
  '/css/mobile.css',
  '/js/pwa.js',
  '/assets/favicon.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname.startsWith('/uploads/')) return false;
  if (url.pathname.startsWith('/socket.io/')) return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isCacheable(url)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          return (await caches.match('/index.html')) || Response.error();
        }
        return Response.error();
      })
  );
});
