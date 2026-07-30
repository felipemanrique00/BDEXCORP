import 'server-only'

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'

import { writeAuditEvent } from '@/lib/server/audit-log'
import { getClientIp } from '@/lib/server/auth-service'
import {
  authorizationForApiRequest,
  AuthorizationDeniedError,
  authorizeOrThrow,
  type AuthorizationRequest,
} from '@/lib/server/authorization-service'
import { getServerEnvironment } from '@/lib/server/environment'
import { logError } from '@/lib/server/logger'
import { consumeRateLimit, type RateLimitPolicy } from '@/lib/server/rate-limit'
import {
  enterRequestContext,
  runWithRequestContext,
  type RequestPrincipal,
} from '@/lib/server/request-context'
import { getSessionPrincipalFromRequest } from '@/lib/server-auth'
import type { Permissoes, User, UserRole } from '@/types'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'

type PermissionName = keyof Permissoes

interface ApiGuardOptions {
  requireAuth?: boolean
  permission?: PermissionName
  authorization?: AuthorizationRequest
  roles?: UserRole[]
  roleKeys?: string[]
  platformAdmin?: boolean
  tenantAdmin?: boolean
  entitlement?: string
  rateLimit?: RateLimitPolicy
  csrf?: boolean
}

export interface ApiGuardResult {
  user: User | null
  principal: RequestPrincipal | null
  requestId: string
  response?: NextResponse
}

export function runInApiGuardContext<T>(
  guard: ApiGuardResult,
  operation: () => T,
): T {
  if (!guard.principal) {
    throw new Error('Contexto autenticado obrigatorio.')
  }
  return runWithRequestContext(
    { requestId: guard.requestId, principal: guard.principal },
    operation,
  )
}

export async function guardApiRequest(request: Request, options: ApiGuardOptions = {}): Promise<ApiGuardResult> {
  const requestId = requestIdFrom(request)
  const mustAuthenticate = options.requireAuth !== false
  let principal: RequestPrincipal | null = null

  try {
    principal = await getSessionPrincipalFromRequest(request)
  } catch {
    return guardedError(requestId, 503, 'AUTH_SERVICE_UNAVAILABLE', 'Servico de autenticacao temporariamente indisponivel.')
  }

  const user = principal?.user || null

  if (options.rateLimit) {
    try {
      const identity = principal?.user.id || getClientIp(request) || 'unknown'
      const limit = await consumeRateLimit(identity, options.rateLimit)
      if (!limit.allowed) {
        return {
          user,
          principal,
          requestId,
          response: NextResponse.json(
            { ok: false, error: 'Muitas requisicoes. Tente novamente em instantes.', code: 'RATE_LIMITED', requestId },
            {
              status: 429,
              headers: {
                'Retry-After': String(limit.retryAfterSeconds),
                'X-Request-Id': requestId,
                'X-RateLimit-Remaining': String(limit.remaining),
              },
            },
          ),
        }
      }
    } catch {
      return guardedError(requestId, 503, 'RATE_LIMIT_UNAVAILABLE', 'Servico temporariamente indisponivel.')
    }
  }

  if (mustAuthenticate && !principal) {
    return guardedError(requestId, 401, 'AUTH_REQUIRED', 'Sessao obrigatoria.')
  }

  if ((options.csrf ?? true) && isStateChanging(request.method) && !validRequestOrigin(request)) {
    await auditDenied(request, principal, requestId, 'csrf_origin')
    return guardedError(requestId, 403, 'INVALID_ORIGIN', 'Origem da requisicao nao autorizada.', user, principal)
  }

  if (options.platformAdmin && !principal?.platformAdmin) {
    await auditDenied(request, principal, requestId, 'platform_admin_required')
    return guardedError(requestId, 403, 'PLATFORM_ADMIN_REQUIRED', 'Acesso restrito a administracao da plataforma.', user, principal)
  }

  if (options.tenantAdmin && !principal?.platformAdmin && principal?.roleKey !== 'tenant_admin') {
    await auditDenied(request, principal, requestId, 'tenant_admin_required')
    return guardedError(requestId, 403, 'TENANT_ADMIN_REQUIRED', 'Acesso restrito a administracao do tenant.', user, principal)
  }

  if (options.permission && !hasServerPermission(user, options.permission)) {
    await auditDenied(request, principal, requestId, `permission:${options.permission}`)
    return guardedError(requestId, 403, 'PERMISSION_DENIED', 'Permissao insuficiente.', user, principal)
  }

  if (options.roles && (!user || !options.roles.includes(user.role))) {
    await auditDenied(request, principal, requestId, 'role_denied')
    return guardedError(requestId, 403, 'ROLE_DENIED', 'Perfil sem acesso a esta operacao.', user, principal)
  }

  if (options.roleKeys && (!principal || !options.roleKeys.includes(principal.roleKey))) {
    await auditDenied(request, principal, requestId, 'membership_role_denied')
    return guardedError(requestId, 403, 'MEMBERSHIP_ROLE_DENIED', 'Perfil interno sem acesso a esta operacao.', user, principal)
  }

  if (options.entitlement && !principal?.entitlements[options.entitlement]) {
    await auditDenied(request, principal, requestId, `entitlement:${options.entitlement}`)
    return guardedError(requestId, 403, 'FEATURE_NOT_AVAILABLE', 'Funcionalidade indisponivel no plano atual.', user, principal)
  }

  if (principal && mustAuthenticate) {
    try {
      authorizeOrThrow(
        principal,
        options.authorization || await authorizationForApiRequest(request, options.permission),
      )
    } catch (error) {
      if (error instanceof AuthorizationDeniedError) {
        await auditDenied(request, principal, requestId, `authorization:${error.code}`)
        return guardedError(
          requestId,
          error.status,
          error.code,
          error.message,
          user,
          principal,
        )
      }
      throw error
    }
  }

  if (principal) enterRequestContext({ requestId, principal })
  return { user, principal, requestId }
}

export function hasServerPermission(user: User | null, permission: PermissionName): boolean {
  if (!user || user.ativo === false) return false
  if (user.permissoes && typeof user.permissoes[permission] === 'boolean') return user.permissoes[permission]
  if (user.perfil_bbt) return Boolean(PERMISSOES_PADRAO_POR_PERFIL[user.perfil_bbt]?.[permission])
  return false
}

function guardedError(
  requestId: string,
  status: number,
  code: string,
  error: string,
  user: User | null = null,
  principal: RequestPrincipal | null = null,
): ApiGuardResult {
  return {
    user,
    principal,
    requestId,
    response: NextResponse.json(
      { ok: false, error, code, requestId },
      { status, headers: { 'X-Request-Id': requestId } },
    ),
  }
}

async function auditDenied(
  request: Request,
  principal: RequestPrincipal | null,
  requestId: string,
  reason: string,
): Promise<void> {
  try {
    await writeAuditEvent({
      action: 'access.denied',
      result: 'denied',
      tenantId: principal?.tenantId || null,
      actorUserId: principal?.user.id || null,
      requestId,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      metadata: { reason, method: request.method, route: new URL(request.url).pathname },
    })
  } catch (error) {
    logError('access_denied_audit_failed', error, {
      requestId,
      tenantId: principal?.tenantId,
      userId: principal?.user.id,
      route: new URL(request.url).pathname,
      errorCode: 'AUDIT_WRITE_FAILED',
    })
  }
}

function validRequestOrigin(request: Request): boolean {
  if (!isStateChanging(request.method)) return true
  const origin = request.headers.get('origin')
  if (!origin) return process.env.NODE_ENV !== 'production'

  const allowed = new Set<string>()
  const appUrl = getServerEnvironment().APP_URL
  if (appUrl) {
    try {
      allowed.add(new URL(appUrl).origin)
    } catch {
      return false
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    try {
      allowed.add(new URL(request.url).origin)
    } catch {
      return false
    }
  }
  return allowed.has(origin)
}

function isStateChanging(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

function requestIdFrom(request: Request): string {
  const incoming = request.headers.get('x-request-id')?.trim()
  return incoming && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : randomUUID()
}
