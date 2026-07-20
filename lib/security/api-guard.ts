import { NextResponse } from 'next/server'

import { authRequired, getSessionUserFromRequest } from '@/lib/server-auth'
import type { Permissoes, User, UserRole } from '@/types'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'

type PermissionName = keyof Permissoes

interface RateLimitConfig {
  key: string
  limit: number
  windowMs: number
}

interface ApiGuardOptions {
  requireAuth?: boolean
  permission?: PermissionName
  roles?: UserRole[]
  rateLimit?: RateLimitConfig
}

interface ApiGuardResult {
  user: User | null
  response?: NextResponse
}

const buckets = new Map<string, { count: number; resetAt: number }>()
const MAX_RATE_LIMIT_BUCKETS = 5_000

export function guardApiRequest(request: Request, options: ApiGuardOptions = {}): ApiGuardResult {
  const user = getSessionUserFromRequest(request)
  const mustAuth = options.requireAuth ?? authRequired()

  if (options.rateLimit) {
    const blocked = checkRateLimit(request, options.rateLimit, user)
    if (blocked) return { user, response: blocked }
  }

  if (mustAuth && !user) {
    return {
      user: null,
      response: NextResponse.json({ ok: false, error: 'Sessao obrigatoria.' }, { status: 401 }),
    }
  }

  if (options.permission && !hasServerPermission(user, options.permission)) {
    return {
      user,
      response: NextResponse.json({ ok: false, error: 'Permissao insuficiente.' }, { status: 403 }),
    }
  }

  if (options.roles && (!user || !options.roles.includes(user.role))) {
    return {
      user,
      response: NextResponse.json({ ok: false, error: 'Perfil sem acesso a esta operacao.' }, { status: 403 }),
    }
  }

  return { user }
}

export function hasServerPermission(user: User | null, permission: PermissionName): boolean {
  if (!user) return false
  if (user.role === 'master' && user.perfil_bbt === 'lider') return true
  if (user.permissoes) return Boolean(user.permissoes[permission])
  if (user.perfil_bbt) return Boolean(PERMISSOES_PADRAO_POR_PERFIL[user.perfil_bbt]?.[permission])
  return false
}

function checkRateLimit(request: Request, config: RateLimitConfig, user: User | null): NextResponse | null {
  const now = Date.now()
  cleanupExpiredBuckets(now)

  const identity = user?.id || getClientIdentity(request)
  const key = `${config.key}:${identity}`
  const current = buckets.get(key)

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + config.windowMs })
    return null
  }

  current.count += 1
  if (current.count <= config.limit) return null

  const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000))
  return NextResponse.json(
    { ok: false, error: 'Muitas requisicoes. Tente novamente em instantes.' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  )
}

function getClientIdentity(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return request.headers.get('x-real-ip')?.trim() || forwarded || 'local'
}

function cleanupExpiredBuckets(now: number): void {
  if (buckets.size < MAX_RATE_LIMIT_BUCKETS) return

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }

  if (buckets.size < MAX_RATE_LIMIT_BUCKETS) return

  const oldest = [...buckets.entries()]
    .sort((left, right) => left[1].resetAt - right[1].resetAt)
    .slice(0, Math.ceil(MAX_RATE_LIMIT_BUCKETS * 0.1))

  oldest.forEach(([key]) => buckets.delete(key))
}

export function resetApiRateLimitsForTests(): void {
  if (process.env.NODE_ENV !== 'test') return
  buckets.clear()
}
