// Bump VERSION on every deploy. The new worker installs in the background;
// the page shows "Update now", and only then does it take over.
const VERSION = 'v1.1.0';
const CACHE = `ohm-meter-${VERSION}`;
// Real-life photos live in their own cache so app updates don't throw away saved photos.
const PHOTO_CACHE = 'ohm-meter-photos';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/core.js',
  './js/render.js',
  './js/audio.js',
  './manifest.webmanifest',
  './photos/photos.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('ohm-meter-') && k !== CACHE && k !== PHOTO_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Navigations: serve the cached app shell, falling back to the network.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match('./index.html')) || fetch(req);
    })());
    return;
  }

  // Photo list: network first so newly added photos appear without an app update.
  if (new URL(req.url).pathname.endsWith('/photos/photos.json')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) cache.put('./photos/photos.json', res.clone());
        return res;
      } catch {
        return (await cache.match('./photos/photos.json')) || Response.error();
      }
    })());
    return;
  }

  // Assets: cache first; cache anything new that the app asks for later.
  const isPhoto = /\/photos\/[^/]+\.jpg$/.test(new URL(req.url).pathname);
  event.respondWith((async () => {
    const cache = await caches.open(isPhoto ? PHOTO_CACHE : CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  })());
});
