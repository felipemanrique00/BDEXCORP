/* BBT Corporativo - Service Worker V20
 *
 * Authenticated HTML, API responses and documents are never cached.
 * Offline traveler data is opt-in and stored separately by the application.
 */
const CACHE_VERSION = 'bbt-shell-v20-1'
const OFFLINE_PAGE = '/offline.html'
const CORE_ASSETS = [
  OFFLINE_PAGE,
  '/manifest.webmanifest',
  '/brand/bbt-corporativo-mark.png',
  '/brand/bbt-corporativo-mark-192.png',
  '/brand/bbt-corporativo-mark-512.png',
  '/brand/bbt-corporativo-mark-color.webp',
  '/brand/bbt-corporativo-mark-white.webp',
  '/brand/bbt-corporativo-lockup-color.webp',
  '/brand/bbt-corporativo-lockup-white.webp',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('bbt-') && key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (
    url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/_next/data/')
    || url.pathname.startsWith('/relatorios/')
  ) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_PAGE))
    )
    return
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request))
    return
  }

  if (CORE_ASSETS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request))
  }
})

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(CACHE_VERSION)
    await cache.put(request, response.clone())
  }
  return response
}
