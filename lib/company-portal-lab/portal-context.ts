import { defaultCorporateContextOption } from '@/lib/corporate-context-selection'
import type { UserAccessKind } from '@/lib/user-access-kind'
import type { CorporateAccessSummary, CorporateContextOption } from '@/types'

/**
 * Resolves the effective Portal Empresa context without changing the user's
 * global corporate scope. Corporate sessions see only companies explicitly
 * enabled for this portal; internal agency sessions preserve their complete
 * operational context.
 */
export function resolveCompanyPortalContext(
  access: CorporateAccessSummary | null | undefined,
  context: CorporateContextOption | null | undefined,
  accessKind: UserAccessKind,
): CorporateContextOption | null {
  const selected = context || defaultCorporateContextOption(access)
  if (accessKind === 'internal') return selected
  if (!access) return null

  const enabledCompanyIds = new Set(
    access.companies
      .filter((company) => company.companyPortalEnabled !== false)
      .map((company) => company.companyId),
  )
  const selectedPortalContext = restrictContextToEnabledCompanies(selected, enabledCompanyIds)
  if (selectedPortalContext) return selectedPortalContext

  for (const candidate of access.contexts) {
    const portalContext = restrictContextToEnabledCompanies(candidate, enabledCompanyIds)
    if (portalContext) return portalContext
  }
  return null
}

function restrictContextToEnabledCompanies(
  context: CorporateContextOption | null | undefined,
  enabledCompanyIds: ReadonlySet<string>,
): CorporateContextOption | null {
  if (!context) return null
  const companyIds = context.companyIds.filter((companyId) => enabledCompanyIds.has(companyId))
  if (!companyIds.length) return null
  if (companyIds.length === context.companyIds.length) return context
  return { ...context, companyIds }
}
