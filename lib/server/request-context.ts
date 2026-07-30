import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'

import type { AuthorizationScopeGrant, CorporateAccessSummary, User } from '@/types'

export interface RequestPrincipal {
  sessionId: string
  authenticationLevel?: 'password' | 'mfa' | 'system'
  mfaVerifiedAt?: string | null
  tenantId: string
  tenantSlug: string
  tenantStatus: string
  membershipId: string
  roleKey: string
  platformAdmin: boolean
  planKey: string | null
  entitlements: Record<string, boolean>
  limits: {
    users: number | null
    storageBytes: number | null
    monthlyOperations: number | null
  }
  corporateAccess?: CorporateAccessSummary
  authorizationGrants?: AuthorizationScopeGrant[]
  user: User
}

export interface ServerRequestContext {
  requestId: string
  principal: RequestPrincipal
}

const requestContext = new AsyncLocalStorage<ServerRequestContext>()

export function enterRequestContext(context: ServerRequestContext): void {
  requestContext.enterWith(context)
}

export function runWithRequestContext<T>(context: ServerRequestContext, operation: () => T): T {
  return requestContext.run(context, operation)
}

export function getRequestContext(): ServerRequestContext | null {
  return requestContext.getStore() || null
}

export function requireRequestContext(): ServerRequestContext {
  const context = getRequestContext()
  if (!context) throw new Error('Contexto autenticado obrigatorio.')
  return context
}

export function requireTenantId(): string {
  return requireRequestContext().principal.tenantId
}
