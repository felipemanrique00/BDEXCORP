import { NextResponse, type NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const requestId = validRequestId(request.headers.get('x-request-id'))
    ? request.headers.get('x-request-id')!
    : crypto.randomUUID()
  const nonce = crypto.randomUUID().replaceAll('-', '')
  const production = process.env.NODE_ENV === 'production'
  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${production ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "frame-src 'self' https://www.google.com",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    production ? 'upgrade-insecure-requests' : '',
  ].filter(Boolean).join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', contentSecurityPolicy)
  response.headers.set('X-Request-Id', requestId)
  return response
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}

function validRequestId(value: string | null): boolean {
  return Boolean(value && /^[0-9a-f-]{36}$/i.test(value))
}
