'use client'
/**
 * PWARegister — V17
 *
 * Registra o service worker na primeira montagem do client.
 * Silencioso: erros não quebram a aplicação.
 */
import { useEffect } from 'react'

export function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    const handler = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(() => undefined)
    }

    if (document.readyState === 'complete') handler()
    else window.addEventListener('load', handler, { once: true })

    return () => window.removeEventListener('load', handler)
  }, [])

  return null
}
