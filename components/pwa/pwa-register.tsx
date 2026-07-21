'use client'
/**
 * PWARegister — V17
 *
 * Registra o service worker na primeira montagem do client.
 * Silencioso: erros não quebram a aplicação.
 */
import { useEffect } from 'react'
import { reportClientFailure } from '@/lib/client-observability'

export function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    const handler = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((error) => {
          reportClientFailure('service_worker_registration_failed', error, { component: 'pwa-register' })
        })
    }

    if (document.readyState === 'complete') handler()
    else window.addEventListener('load', handler, { once: true })

    return () => window.removeEventListener('load', handler)
  }, [])

  return null
}
