import 'server-only'

import {
  getSessionTokenFromRequest,
  resolveSession,
} from '@/lib/server/auth-service'
import { getServerEnvironment } from '@/lib/server/environment'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { User } from '@/types'

export function authRequired(): boolean {
  return true
}

export function sessionCookieName(): string {
  return getServerEnvironment().AUTH_COOKIE_NAME
}

export function sessionMaxAgeSeconds(): number {
  return getServerEnvironment().AUTH_SESSION_HOURS * 60 * 60
}

export function secureSessionCookie(request: Request): boolean {
  const environment = getServerEnvironment()
  const requestUrl = new URL(request.url)
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(requestUrl.hostname)
  if (environment.ALLOW_INSECURE_LOCALHOST && isLoopback && requestUrl.protocol === 'http:') return false
  if (process.env.NODE_ENV === 'production') return true
  return request.headers.get('x-forwarded-proto') === 'https' || requestUrl.protocol === 'https:'
}

export async function getSessionPrincipalFromRequest(request: Request): Promise<RequestPrincipal | null> {
  return resolveSession(getSessionTokenFromRequest(request))
}

export async function getSessionUserFromRequest(request: Request): Promise<User | null> {
  return (await getSessionPrincipalFromRequest(request))?.user || null
}
