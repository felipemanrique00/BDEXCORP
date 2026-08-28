import type {
  CorporateAccessSummary,
  CorporateContextOption,
} from '@/types'

export type CorporateViewSelection =
  | { mode: 'all'; companyIds: [] }
  | { mode: 'custom'; companyIds: string[] }

export interface CorporateSelectionOptions {
  allowArbitrarySelection?: boolean
}

export interface CorporateSelectionLabelOptions {
  selectionMode?: CorporateViewSelection['mode']
  context?: CorporateContextOption | null
}

export function defaultCorporateViewSelection(
  access: CorporateAccessSummary | null | undefined,
): CorporateViewSelection {
  if (!access || access.companyIds.length === 0) return customSelection([])
  const context = preferredAuthorizedContext(access)
  return context ? customSelection(context.companyIds) : customSelection([])
}

export function defaultCorporateContextOption(
  access: CorporateAccessSummary | null | undefined,
): CorporateContextOption | null {
  return access ? preferredAuthorizedContext(access) : null
}

export function selectedCompanyIdsForSelection(
  access: CorporateAccessSummary | null | undefined,
  selection: CorporateViewSelection,
  options: CorporateSelectionOptions = {},
): string[] {
  if (!access) return []
  if (selection.mode === 'all') {
    return canSelectAllCompanies(access, options)
      ? [...access.companyIds]
      : preferredAuthorizedContext(access)?.companyIds || []
  }
  return normalizeCompanyIds(access.companyIds, selection.companyIds)
}

export function createCorporateViewSelection(
  access: CorporateAccessSummary | null | undefined,
  requestedCompanyIds: readonly string[],
  options: CorporateSelectionOptions = {},
): CorporateViewSelection | null {
  if (!access) return null
  const companyIds = normalizeCompanyIds(access.companyIds, requestedCompanyIds)
  if (companyIds.length === 0 || !isCorporateCompanySelectionAllowed(access, requestedCompanyIds, options)) return null
  if (sameCompanySet(companyIds, access.companyIds) && canSelectAllCompanies(access, options)) {
    return allCompaniesSelection()
  }
  return customSelection(companyIds)
}

export function createCorporateContextViewSelection(
  access: CorporateAccessSummary | null | undefined,
  type: 'company' | 'group',
  id: string,
): CorporateViewSelection | null {
  if (!access) return null
  const context = access.contexts.find((item) => item.type === type && item.id === id)
  if (!context || !isAuthorizedContext(context)) return null
  const companyIds = normalizeCompanyIds(access.companyIds, context.companyIds)
  return sameCompanySet(companyIds, context.companyIds)
    ? customSelection(companyIds)
    : null
}

export function reconcileCorporateViewSelection(
  access: CorporateAccessSummary | null | undefined,
  selection: CorporateViewSelection,
  options: CorporateSelectionOptions = {},
): CorporateViewSelection {
  if (!access || access.companyIds.length === 0) return customSelection([])
  if (selection.mode === 'all') {
    return canSelectAllCompanies(access, options)
      ? allCompaniesSelection()
      : defaultCorporateViewSelection(access)
  }
  if (options.allowArbitrarySelection) {
    const companyIds = normalizeCompanyIds(access.companyIds, selection.companyIds)
    return companyIds.length > 0
      ? customSelection(companyIds)
      : defaultCorporateViewSelection(access)
  }
  const reconciled = createCorporateViewSelection(access, selection.companyIds, options)
  return reconciled || defaultCorporateViewSelection(access)
}

export function canSelectAllCompanies(
  access: CorporateAccessSummary | null | undefined,
  options: CorporateSelectionOptions = {},
): boolean {
  return Boolean(
    access?.companyIds.length
    && (
      options.allowArbitrarySelection
      || access.contexts.some((context) => (
        isAuthorizedContext(context)
        && sameCompanySet(context.companyIds, access.companyIds)
      ))
    ),
  )
}

export function isCorporateCompanySelectionAllowed(
  access: CorporateAccessSummary,
  requestedCompanyIds: readonly string[],
  options: CorporateSelectionOptions = {},
): boolean {
  const companyIds = normalizeCompanyIds(access.companyIds, requestedCompanyIds)
  return companyIds.length > 0
    && companyIds.length === new Set(requestedCompanyIds).size
    && (
      options.allowArbitrarySelection
      || access.contexts.some((context) => (
        isAuthorizedContext(context)
        && sameCompanySet(context.companyIds, companyIds)
      ))
    )
}

export function contextForCompanySelection(
  access: CorporateAccessSummary | null | undefined,
  selectedCompanyIds: readonly string[],
): CorporateContextOption | null {
  if (!access || selectedCompanyIds.length === 0) return null
  if (selectedCompanyIds.length === 1) {
    return access.contexts.find((context) => (
      context.type === 'company'
      && sameCompanySet(context.companyIds, selectedCompanyIds)
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
  options: CorporateSelectionLabelOptions = {},
): string {
  if (!access || selectedCompanyIds.length === 0) return 'Nenhuma empresa selecionada'
  const contextualSelection = options.selectionMode === 'custom'
    && options.context
    && sameCompanySet(options.context.companyIds, selectedCompanyIds)
    ? options.context
    : null
  if (contextualSelection) {
    return contextualSelection.type === 'group'
      ? `${contextualSelection.label} (${selectedCompanyIds.length})`
      : contextualSelection.label
  }
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

function preferredAuthorizedContext(
  access: CorporateAccessSummary,
): CorporateContextOption | null {
  const preferred = access.defaultContext
    ? access.contexts.find((context) => (
      context.type === access.defaultContext?.type
      && context.id === access.defaultContext.id
      && isAuthorizedContext(context)
    ))
    : null
  return preferred || access.contexts.find(isAuthorizedContext) || null
}

function isAuthorizedContext(context: CorporateContextOption): boolean {
  return context.companyIds.length > 0
    && (
      (context.type === 'company' && context.companyIds.length === 1)
      || (context.type === 'group' && context.canViewConsolidated)
    )
}

function allCompaniesSelection(): CorporateViewSelection {
  return { mode: 'all', companyIds: [] }
}

function customSelection(companyIds: readonly string[]): CorporateViewSelection {
  return { mode: 'custom', companyIds: [...companyIds] }
}
