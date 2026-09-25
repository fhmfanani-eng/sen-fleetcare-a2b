/* SEN-FleetCare PWA Service Worker — forced update package v8, 2026-09-25 */
const SW_VERSION = 'sen-fleetcare-v8-20260925-1500';
const CACHE_NAME = SW_VERSION;
const APP_SHELL = ['./', './index.html'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // HTML/navigation must prefer the newest GitHub Pages deployment.
  if (req.mode === 'navigate' || req.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/' ) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        const copy = fresh.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
        return fresh;
      } catch (_) {
        return (await caches.match(req)) || (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Static assets can be cached, but fall back to network when absent.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh.ok) {
        const copy = fresh.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
      }
      return fresh;
    } catch (_) {
      return Response.error();
    }
  })());
});
