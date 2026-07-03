/* SwingCoach service worker: cache-first app shell so the app works offline
 * on the course. Bump CACHE_VERSION when deploying changes. */

const CACHE_VERSION = 'swingcoach-v4';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './engine.js',
  './app.js',
  './auth.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Only handle same-origin GETs, and never the API — data must not be cached.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/api.php')) return;

  event.respondWith(
    caches.match(event.request).then(cached =>
      cached ||
      fetch(event.request).then(response => {
        // Cache new same-origin assets opportunistically.
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
    )
  );
});
