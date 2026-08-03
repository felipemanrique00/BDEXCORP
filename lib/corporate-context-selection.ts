import type {
  CorporateAccessSummary,
  CorporateContextOption,
} from '@/types'

export type CorporateViewSelection =
  | { mode: 'all'; companyIds: [] }
  | { mode: 'custom'; companyIds: string[] }

export function defaultCorporateViewSelection(
  access: CorporateAccessSummary | null | undefined,
): CorporateViewSelection {
  if (!access || access.companyIds.length === 0) return customSelection([])
  return allCompaniesSelection()
}

export function selectedCompanyIdsForSelection(
  access: CorporateAccessSummary | null | undefined,
  selection: CorporateViewSelection,
): string[] {
  if (!access) return []
  if (selection.mode === 'all') return [...access.companyIds]
  return normalizeCompanyIds(access.companyIds, selection.companyIds)
}

export function createCorporateViewSelection(
  access: CorporateAccessSummary | null | undefined,
  requestedCompanyIds: readonly string[],
): CorporateViewSelection | null {
  if (!access) return null
  const companyIds = normalizeCompanyIds(access.companyIds, requestedCompanyIds)
  if (companyIds.length === 0 || !isCorporateCompanySelectionAllowed(access, requestedCompanyIds)) return null
  if (sameCompanySet(companyIds, access.companyIds)) {
    return allCompaniesSelection()
  }
  return customSelection(companyIds)
}

export function reconcileCorporateViewSelection(
  access: CorporateAccessSummary | null | undefined,
  selection: CorporateViewSelection,
): CorporateViewSelection {
  if (!access || access.companyIds.length === 0) return customSelection([])
  if (selection.mode === 'all') {
    return allCompaniesSelection()
  }
  const reconciled = createCorporateViewSelection(access, selection.companyIds)
  return reconciled || defaultCorporateViewSelection(access)
}

export function canSelectAllCompanies(
  access: CorporateAccessSummary | null | undefined,
): boolean {
  return Boolean(access?.companyIds.length)
}

export function isCorporateCompanySelectionAllowed(
  access: CorporateAccessSummary,
  requestedCompanyIds: readonly string[],
): boolean {
  const companyIds = normalizeCompanyIds(access.companyIds, requestedCompanyIds)
  return companyIds.length > 0 && companyIds.length === new Set(requestedCompanyIds).size
}

export function contextForCompanySelection(
  access: CorporateAccessSummary | null | undefined,
  selectedCompanyIds: readonly string[],
): CorporateContextOption | null {
  if (!access || selectedCompanyIds.length === 0) return null
  if (selectedCompanyIds.length === 1) {
    return access.contexts.find((context) => (
      context.type === 'company' && context.companyIds[0] === selectedCompanyIds[0]
    )) || null
  }
  return access.contexts.find((context) => (
    context.type === 'group'
    && context.canViewConsolidated
    && sameCompanySet(context.companyIds, selectedCompanyIds)
  )) || null
}

export function corporateSelectionLabel(
  access: CorporateAccessSummary | null | undefined,
  selectedCompanyIds: readonly string[],
): string {
  if (!access || selectedCompanyIds.length === 0) return 'Nenhuma empresa selecionada'
  if (sameCompanySet(selectedCompanyIds, access.companyIds)) {
    return `Todas as empresas (${selectedCompanyIds.length})`
  }
  if (selectedCompanyIds.length === 1) {
    return access.companies.find((company) => company.companyId === selectedCompanyIds[0])?.companyName
      || '1 empresa selecionada'
  }
  const group = access.groups.find((item) => sameCompanySet(item.companyIds, selectedCompanyIds))
  return group?.canViewConsolidated
    ? `${group.groupName} (${selectedCompanyIds.length})`
    : `${selectedCompanyIds.length} empresas selecionadas`
}

export function matchesCorporateContextSearch(value: string, query: string): boolean {
  const normalizedQuery = normalizeSearch(query)
  return normalizedQuery.length === 0 || normalizeSearch(value).includes(normalizedQuery)
}

export function sameCompanySet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((companyId) => rightSet.has(companyId))
}

function normalizeCompanyIds(availableCompanyIds: readonly string[], requestedCompanyIds: readonly string[]): string[] {
  const requested = new Set(requestedCompanyIds)
  return availableCompanyIds.filter((companyId) => requested.has(companyId))
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
}

function allCompaniesSelection(): CorporateViewSelection {
  return { mode: 'all', companyIds: [] }
}

function customSelection(companyIds: readonly string[]): CorporateViewSelection {
  return { mode: 'custom', companyIds: [...companyIds] }
}
