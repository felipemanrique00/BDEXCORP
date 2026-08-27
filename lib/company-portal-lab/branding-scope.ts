import type { EffectiveBrandingScope } from '@/lib/branding/effective-branding'

interface CompanyPortalBrandingContext {
  type: 'company' | 'group'
  id: string
}

interface CompanyPortalBrandingInput {
  companyFilter?: string | null
  context?: CompanyPortalBrandingContext | null
  companyIds: readonly string[]
}

export function resolveCompanyPortalBoardBrandingScope({
  companyFilter,
  context,
  companyIds,
}: CompanyPortalBrandingInput): EffectiveBrandingScope | undefined {
  const availableCompanyIds = new Set(companyIds)
  const filteredCompanyId = normalizedAvailableCompanyId(companyFilter, availableCompanyIds)
  if (filteredCompanyId) return { type: 'company', id: filteredCompanyId }

  const contextCompanyId = context?.type === 'company'
    ? normalizedAvailableCompanyId(context.id, availableCompanyIds)
    : ''
  if (contextCompanyId) return { type: 'company', id: contextCompanyId }

  const contextGroupId = context?.type === 'group' ? context.id.trim() : ''
  if (contextGroupId && companyIds.length > 0) return { type: 'group', id: contextGroupId }

  if (companyIds.length === 1) return { type: 'company', id: companyIds[0] }
  return undefined
}

export function resolveCompanyPortalInitialCompanyId({
  companyFilter,
  context,
  companyIds,
}: CompanyPortalBrandingInput): string {
  const availableCompanyIds = new Set(companyIds)
  return normalizedAvailableCompanyId(companyFilter, availableCompanyIds)
    || (context?.type === 'company'
      ? normalizedAvailableCompanyId(context.id, availableCompanyIds)
      : '')
    || companyIds[0]
    || ''
}

function normalizedAvailableCompanyId(
  companyId: string | null | undefined,
  availableCompanyIds: ReadonlySet<string>,
): string {
  const normalized = String(companyId || '').trim()
  return normalized && availableCompanyIds.has(normalized) ? normalized : ''
}
