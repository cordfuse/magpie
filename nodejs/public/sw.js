// Self-destruct service worker.
//
// next-pwa was shipped briefly while quill was forked from mighty-ai-qr-web.
// The cached SW from that period (and from any prior app that ran on the
// same origin) intercepts requests and serves stale HTML/JS/CSS — which
// caused the "Quill looks butchered" bug. This SW replaces the old one,
// purges every cache, unregisters itself, and reloads any open client.
//
// Once everyone affected has reloaded at least once, this file (and the
// /sw.js header rule in next.config.ts) can be removed. Until then, keep
// serving it with no-cache so the eviction propagates.

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.map(n => caches.delete(n)))
    await self.registration.unregister()
    const clients = await self.clients.matchAll({ type: 'window' })
    for (const client of clients) {
      try { client.navigate(client.url) } catch { /* nav blocked — ignore */ }
    }
  })())
})
