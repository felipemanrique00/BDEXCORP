/* BBT Corporativo - Service Worker V19
 *
 * Estratégia: network-first com fallback de cache.
 * Cache leve do shell (logo, manifest, página de login) pra abertura
 * instantânea quando offline.
 *
 * Não cacheia /api/* nem /_next/data/*  (sempre tenta network).
 */
const CACHE_VERSION = 'bbt-cache-v19-1'
const CORE_ASSETS = [
  '/manifest.webmanifest',
  '/brand/bbt-corporativo-mark.png',
  '/brand/bbt-corporativo-mark-192.png',
  '/brand/bbt-corporativo-mark-512.png',
  '/brand/bbt-corporativo-mark-color.webp',
  '/brand/bbt-corporativo-mark-white.webp',
  '/brand/bbt-corporativo-lockup-color.webp',
  '/brand/bbt-corporativo-lockup-white.webp',
  '/brand/bbt-corporativo-report-v2.webp',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith('bbt-cache-') && k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // Não cacheia API nem dados internos do Next
  if (url.pathname.startsWith('/api/')) return
  if (url.pathname.startsWith('/_next/data/')) return

  // Network-first com fallback de cache
  event.respondWith(
    fetch(req)
      .then((response) => {
        // Salva clone no cache pros estáticos básicos
        if (response.ok && (CORE_ASSETS.includes(url.pathname) || url.pathname.startsWith('/_next/static/'))) {
          const clone = response.clone()
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone)).catch(() => {})
        }
        return response
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/brand/bbt-corporativo-mark.png')))
  )
})
