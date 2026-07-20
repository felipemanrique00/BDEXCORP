import { createHmac, timingSafeEqual } from 'node:crypto'

import type { User } from '@/types'

const COOKIE_NAME = 'bbt_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12

interface SessionPayload {
  user: User
  iat: number
}

export function authRequired(): boolean {
  if (process.env.NODE_ENV === 'production') return true
  return process.env.AUTH_REQUIRE_SESSION === 'true'
}

export function sessionCookieName(): string {
  return COOKIE_NAME
}

export function sessionMaxAgeSeconds(): number {
  return SESSION_MAX_AGE_SECONDS
}

export function signSession(user: User): string {
  const payload: SessionPayload = {
    user,
    iat: Date.now(),
  }
  const body = base64url(JSON.stringify(payload))
  const sig = createHmac('sha256', getSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifySessionToken(token: string | undefined | null): User | null {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null

  const expected = createHmac('sha256', getSecret()).update(body).digest('base64url')
  if (!safeCompare(sig, expected)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (!payload?.user?.id || !payload.iat) return null
    if (Date.now() - payload.iat > SESSION_MAX_AGE_SECONDS * 1000) return null
    return payload.user
  } catch {
    return null
  }
}

export function getSessionUserFromRequest(request: Request): User | null {
  const cookie = request.headers.get('cookie') || ''
  const token = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1)
  return verifySessionToken(decodeURIComponent(token || ''))
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET obrigatorio em producao.')
  }
  return 'bbt-dev-secret-change-in-production'
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
