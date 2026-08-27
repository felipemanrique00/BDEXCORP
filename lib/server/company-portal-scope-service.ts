import 'server-only'

import { CorporateAccessDeniedError } from '@/lib/server/corporate-access-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { userAccessKind } from '@/lib/user-access-kind'
import type { Permissoes } from '@/types'

export interface CompanyPortalScope {
  scopeType?: 'company' | 'group'
  scopeId?: string
  companyId?: string
}

/**
 * Resolves a Portal Empresa selection to the exact authorized company set.
 *
 * Corporate users must use one of the contexts supplied by their access
 * summary (or its default context). Arbitrary unions of companies are never
 * accepted. Internal users keep their permission-scoped operational view when
 * no corporate context is supplied, which preserves the local support/test
 * workflow without widening a corporate session.
 */
export function resolveCompanyPortalScopeCompanyIds(
  principal: RequestPrincipal,
  scope: CompanyPortalScope = {},
  permission: keyof Permissoes,
): string[] {
  return resolveCompanyPortalScopeCompanyIdsWithAnyPermission(
    principal,
    scope,
    [permission],
  )
}

export function resolveCompanyPortalScopeCompanyIdsWithAnyPermission(
  principal: RequestPrincipal,
  scope: CompanyPortalScope = {},
  permissions: readonly (keyof Permissoes)[],
): string[] {
  const requestedPermissions = [...new Set(permissions)]
  if (!requestedPermissions.length) {
    throw scopeDenied(
      'COMPANY_PORTAL_PERMISSION_SCOPE_INVALID',
      'Informe ao menos uma permissao para resolver o contexto corporativo.',
    )
  }
  const access = principal.corporateAccess
  const scopeId = scope.scopeId?.trim()
  const companyId = scope.companyId?.trim()
  const hasScopeType = Boolean(scope.scopeType)
  const hasScopeId = Boolean(scopeId)

  if (hasScopeType !== hasScopeId) {
    throw scopeDenied(
      'COMPANY_PORTAL_SCOPE_INVALID',
      'Informe o tipo e o identificador do contexto corporativo.',
    )
  }
  if (!access) {
    throw scopeDenied(
      'COMPANY_PORTAL_SCOPE_DENIED',
      'O usuario nao possui um escopo corporativo autorizado.',
    )
  }

  const corporateUser = isCorporatePortalCaller(principal)
  const portalEnabledCompanyIds = corporateUser
    ? new Set(access.companies
        .filter((company) => company.companyPortalEnabled !== false)
        .map((company) => company.companyId))
    : null
  const requestedScope = hasScopeType && hasScopeId
    ? { type: scope.scopeType!, id: scopeId! }
    : corporateUser
      ? access.defaultContext
      : null

  if (!requestedScope) {
    if (corporateUser) {
      throw scopeDenied(
        'COMPANY_PORTAL_CONTEXT_SCOPE_DENIED',
        'Selecione um grupo ou uma empresa autorizada para acessar este recurso.',
      )
    }
    const permittedCompanyIds = narrowToRequestedCompany(
      access.companies
        .filter((company) => (
          (!portalEnabledCompanyIds || portalEnabledCompanyIds.has(company.companyId))
          && requestedPermissions.some((permission) => company.permissions[permission])
        ))
        .map((company) => company.companyId),
      companyId,
    )
    if (!permittedCompanyIds.length) {
      throw scopeDenied(
        'COMPANY_PORTAL_SCOPE_EMPTY',
        'O usuario nao possui empresas autorizadas para este recurso.',
      )
    }
    return permittedCompanyIds
  }

  const context = access.contexts.find((candidate) => (
    candidate.type === requestedScope.type && candidate.id === requestedScope.id
  ))
  if (!context || (context.type === 'group' && !context.canViewConsolidated)) {
    throw scopeDenied(
      'COMPANY_PORTAL_CONTEXT_SCOPE_DENIED',
      'Grupo ou empresa fora do contexto corporativo autorizado.',
    )
  }

  const permittedCompanyIds = context.companyIds.filter((contextCompanyId) => (
    access.companies.some((company) => (
      company.companyId === contextCompanyId
      && (!portalEnabledCompanyIds || portalEnabledCompanyIds.has(company.companyId))
      && requestedPermissions.some((permission) => company.permissions[permission])
    ))
  ))
  const narrowed = narrowToRequestedCompany(permittedCompanyIds, companyId)
  if (!narrowed.length) {
    throw scopeDenied(
      'COMPANY_PORTAL_SCOPE_EMPTY',
      'O contexto selecionado nao possui empresas autorizadas para este recurso.',
    )
  }
  return narrowed
}

/**
 * Authorizes a company-bound Portal Empresa resource after its company was
 * loaded from the relational record (for example, a demand or reservation).
 *
 * Corporate callers are evaluated through the exact company context so a
 * stale/default client context cannot widen or accidentally narrow the
 * resource check. Internal agency callers keep their operational company
 * scope and are not blocked by the Portal Empresa enablement flag.
 */
export function resolveCompanyPortalResourceCompanyId(
  principal: RequestPrincipal,
  companyIdInput: string,
  permission: keyof Permissoes,
): string {
  const companyId = companyIdInput.trim()
  if (!companyId) {
    throw scopeDenied(
      'COMPANY_PORTAL_COMPANY_SCOPE_INVALID',
      'A empresa do recurso corporativo nao foi informada.',
    )
  }
  const scope: CompanyPortalScope = isCorporatePortalCaller(principal)
    ? { scopeType: 'company', scopeId: companyId, companyId }
    : { companyId }
  const companyIds = resolveCompanyPortalScopeCompanyIds(principal, scope, permission)
  if (companyIds.length !== 1 || companyIds[0] !== companyId) {
    throw scopeDenied(
      'COMPANY_PORTAL_COMPANY_SCOPE_DENIED',
      'Empresa fora do contexto corporativo autorizado.',
    )
  }
  return companyId
}

/**
 * Gates tenant-wide catalogs used by the Portal Empresa when the catalog has
 * no company-owned record from which to derive an exact scope. Corporate
 * callers need at least one enabled Portal Empresa context; internal agency
 * callers retain their permission-scoped operational view.
 */
export function resolveAnyEnabledCompanyPortalContextCompanyIds(
  principal: RequestPrincipal,
  permission: keyof Permissoes,
): string[] {
  if (!isCorporatePortalCaller(principal)) {
    return resolveCompanyPortalScopeCompanyIds(principal, {}, permission)
  }

  const access = principal.corporateAccess
  if (!access) {
    return resolveCompanyPortalScopeCompanyIds(principal, {}, permission)
  }
  for (const context of access.contexts) {
    try {
      const companyIds = resolveCompanyPortalScopeCompanyIds(
        principal,
        { scopeType: context.type, scopeId: context.id },
        permission,
      )
      if (companyIds.length) return companyIds
    } catch (error) {
      if (!(error instanceof CorporateAccessDeniedError)) throw error
    }
  }
  throw scopeDenied(
    'COMPANY_PORTAL_SCOPE_EMPTY',
    'O usuario nao possui um contexto habilitado no Portal Empresa para este recurso.',
  )
}

function isCorporatePortalCaller(principal: RequestPrincipal): boolean {
  const internalAgencyActor = principal.actor
    && userAccessKind(principal.actor.user) === 'internal'
  return userAccessKind(principal.user) === 'corporate' && !internalAgencyActor
}

function narrowToRequestedCompany(companyIds: string[], companyId?: string): string[] {
  if (!companyId) return companyIds
  if (!companyIds.includes(companyId)) {
    throw scopeDenied(
      'COMPANY_PORTAL_COMPANY_SCOPE_DENIED',
      'Empresa fora do grupo ou empresa selecionado.',
    )
  }
  return [companyId]
}

function scopeDenied(code: string, message: string): CorporateAccessDeniedError {
  return new CorporateAccessDeniedError(code, message)
}
