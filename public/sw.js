// NexTrade AI — Service Worker minimal (permet l'installation PWA)
const CACHE = 'nextrade-v1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });
self.addEventListener('fetch', e => {
  // Network-first : toujours les données fraîches (trading = temps réel)
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
