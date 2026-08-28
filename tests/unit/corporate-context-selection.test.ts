import { describe, expect, it } from 'vitest'

import {
  canSelectAllCompanies,
  contextForCompanySelection,
  corporateSelectionLabel,
  createCorporateContextViewSelection,
  createCorporateViewSelection,
  defaultCorporateContextOption,
  defaultCorporateViewSelection,
  isCorporateCompanySelectionAllowed,
  matchesCorporateContextSearch,
  reconcileCorporateViewSelection,
  selectedCompanyIdsForSelection,
  type CorporateViewSelection,
} from '@/lib/corporate-context-selection'
import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import type {
  CorporateAccessSummary,
  CorporateCompanyAccessSummary,
  CorporateContextOption,
} from '@/types'

const internalSelectionOptions = { allowArbitrarySelection: true }

function access(overrides: Partial<CorporateAccessSummary> = {}): CorporateAccessSummary {
  const permissions = permissionsForCorporateProfile('group_admin', {})
  return {
    tenantWide: true,
    companyIds: ['company-a', 'company-b', 'company-c'],
    groupIds: ['group-a'],
    companies: [
      { companyId: 'company-a', companyName: 'Empresa Árvore', groupId: 'group-a', groupName: 'Grupo Alpha', sources: ['group_all'], profiles: ['group_admin'], permissions },
      { companyId: 'company-b', companyName: 'Empresa Brasil', groupId: 'group-a', groupName: 'Grupo Alpha', sources: ['group_all'], profiles: ['group_admin'], permissions },
      { companyId: 'company-c', companyName: 'Empresa Serviços', groupId: null, groupName: null, sources: ['direct'], profiles: ['group_admin'], permissions },
    ],
    groups: [{
      groupId: 'group-a',
      groupName: 'Grupo Alpha',
      companyIds: ['company-a', 'company-b'],
      canViewConsolidated: true,
      accessModes: ['all_companies'],
      profiles: ['group_admin'],
    }],
    contexts: [
      { type: 'group', id: 'group-a', label: 'Visao consolidada - Grupo Alpha', groupId: 'group-a', companyIds: ['company-a', 'company-b'], canViewConsolidated: true },
      { type: 'company', id: 'company-a', label: 'Empresa Árvore', groupId: 'group-a', companyIds: ['company-a'], canViewConsolidated: false },
      { type: 'company', id: 'company-b', label: 'Empresa Brasil', groupId: 'group-a', companyIds: ['company-b'], canViewConsolidated: false },
      { type: 'company', id: 'company-c', label: 'Empresa Serviços', groupId: null, companyIds: ['company-c'], canViewConsolidated: false },
    ],
    defaultContext: { type: 'group', id: 'group-a' },
    refreshedAt: new Date(0).toISOString(),
    ...overrides,
  }
}

describe('corporate context company selection', () => {
  it('opens tenant-wide access in its authorized default group instead of every company', () => {
    const summary = access()
    const selection = defaultCorporateViewSelection(summary)

    expect(selection).toEqual({ mode: 'custom', companyIds: ['company-a', 'company-b'] })
    expect(selectedCompanyIdsForSelection(summary, selection)).toEqual(['company-a', 'company-b'])
    expect(defaultCorporateContextOption(summary)?.id).toBe('group-a')
    expect(canSelectAllCompanies(summary)).toBe(false)
  })

  it('keeps an exact default for internal access while allowing explicit global selection', () => {
    const scoped = access({ tenantWide: false })
    const defaultSelection = defaultCorporateViewSelection(scoped)
    const globalSelection = createCorporateViewSelection(
      scoped,
      scoped.companyIds,
      internalSelectionOptions,
    )

    expect(defaultSelection).toEqual({ mode: 'custom', companyIds: ['company-a', 'company-b'] })
    expect(selectedCompanyIdsForSelection(scoped, defaultSelection, internalSelectionOptions))
      .toEqual(['company-a', 'company-b'])
    expect(globalSelection).toEqual({ mode: 'all', companyIds: [] })
    expect(selectedCompanyIdsForSelection(scoped, globalSelection!, internalSelectionOptions))
      .toEqual(['company-a', 'company-b', 'company-c'])
    expect(canSelectAllCompanies(scoped, internalSelectionOptions)).toBe(true)
    expect(contextForCompanySelection(
      scoped,
      selectedCompanyIdsForSelection(scoped, globalSelection!, internalSelectionOptions),
    )).toBeNull()
  })

  it('reconciles a stale all mode to the authorized default context', () => {
    const summary = access()
    const companyD: CorporateCompanyAccessSummary = {
      companyId: 'company-d',
      companyName: 'Empresa Dinamica',
      groupId: null,
      groupName: null,
      sources: ['direct'],
      profiles: ['group_admin'],
      permissions: permissionsForCorporateProfile('group_admin', {}),
    }
    const companyDContext: CorporateContextOption = {
      type: 'company',
      id: 'company-d',
      label: 'Empresa Dinamica',
      groupId: null,
      companyIds: ['company-d'],
      canViewConsolidated: false,
    }
    const expanded = access({
      companyIds: [...summary.companyIds, companyD.companyId],
      companies: [...summary.companies, companyD],
      contexts: [...summary.contexts, companyDContext],
    })
    const allSelection: CorporateViewSelection = { mode: 'all', companyIds: [] }
    const customSelection: CorporateViewSelection = { mode: 'custom', companyIds: ['company-b'] }

    expect(selectedCompanyIdsForSelection(
      expanded,
      reconcileCorporateViewSelection(expanded, allSelection),
    )).toEqual(['company-a', 'company-b'])
    expect(reconcileCorporateViewSelection(
      expanded,
      customSelection,
    )).toEqual({ mode: 'custom', companyIds: ['company-b'] })
  })

  it('opens scoped access in the authorized default group', () => {
    const scoped = access({ tenantWide: false })

    expect(defaultCorporateViewSelection(scoped))
      .toEqual({ mode: 'custom', companyIds: ['company-a', 'company-b'] })
    expect(selectedCompanyIdsForSelection(scoped, defaultCorporateViewSelection(scoped)))
      .toEqual(['company-a', 'company-b'])
    expect(canSelectAllCompanies(scoped)).toBe(false)
  })

  it('keeps internal all mode dynamic when refreshed access adds a company', () => {
    const summary = access({ tenantWide: false })
    const companyD: CorporateCompanyAccessSummary = {
      companyId: 'company-d',
      companyName: 'Empresa Dinamica',
      groupId: null,
      groupName: null,
      sources: ['direct'],
      profiles: ['group_admin'],
      permissions: permissionsForCorporateProfile('group_admin', {}),
    }
    const companyDContext: CorporateContextOption = {
      type: 'company',
      id: companyD.companyId,
      label: companyD.companyName,
      groupId: null,
      companyIds: [companyD.companyId],
      canViewConsolidated: false,
    }
    const expanded = access({
      tenantWide: false,
      companyIds: [...summary.companyIds, companyD.companyId],
      companies: [...summary.companies, companyD],
      contexts: [...summary.contexts, companyDContext],
    })
    const reconciled = reconcileCorporateViewSelection(
      expanded,
      { mode: 'all', companyIds: [] },
      internalSelectionOptions,
    )

    expect(reconciled).toEqual({ mode: 'all', companyIds: [] })
    expect(selectedCompanyIdsForSelection(expanded, reconciled, internalSelectionOptions))
      .toEqual(['company-a', 'company-b', 'company-c', 'company-d'])
  })

  it('reconciles an internal custom selection by intersection without broadening its scope', () => {
    const summary = access({
      tenantWide: false,
      companyIds: ['company-b', 'company-c'],
      companies: access().companies.filter((company) => company.companyId !== 'company-a'),
      contexts: access().contexts.filter((context) => context.type === 'company' && context.id !== 'company-a'),
      defaultContext: { type: 'company', id: 'company-b' },
    })

    expect(reconcileCorporateViewSelection(
      summary,
      { mode: 'custom', companyIds: ['company-a', 'company-c'] },
      internalSelectionOptions,
    )).toEqual({ mode: 'custom', companyIds: ['company-c'] })
    expect(reconcileCorporateViewSelection(
      summary,
      { mode: 'custom', companyIds: ['company-a'] },
      internalSelectionOptions,
    )).toEqual({ mode: 'custom', companyIds: ['company-b'] })

    const reduced = access({
      tenantWide: false,
      companyIds: ['company-a', 'company-b'],
      companies: access().companies.slice(0, 2),
      contexts: access().contexts.filter((context) => context.id !== 'company-c'),
    })
    const reducedSelection = reconcileCorporateViewSelection(
      reduced,
      { mode: 'custom', companyIds: ['company-a', 'company-b', 'company-c'] },
      internalSelectionOptions,
    )

    expect(reducedSelection).toEqual({ mode: 'custom', companyIds: ['company-a', 'company-b'] })
    expect(reconcileCorporateViewSelection(access(), reducedSelection, internalSelectionOptions))
      .toEqual({ mode: 'custom', companyIds: ['company-a', 'company-b'] })
  })

  it('rejects an explicit full selection that crosses authorized contexts', () => {
    const summary = access()
    expect(createCorporateViewSelection(summary, ['company-c', 'company-a', 'company-b']))
      .toBeNull()
  })

  it('allows only exact company or consolidated-group contexts', () => {
    const scoped = access({ tenantWide: false })
    expect(canSelectAllCompanies(scoped)).toBe(false)
    expect(createCorporateViewSelection(scoped, ['company-a', 'company-b']))
      .toEqual({ mode: 'custom', companyIds: ['company-a', 'company-b'] })
    expect(createCorporateViewSelection(scoped, ['company-a', 'company-c']))
      .toBeNull()
    expect(createCorporateViewSelection(scoped, scoped.companyIds))
      .toBeNull()
    expect(createCorporateViewSelection(scoped, ['company-a']))
      .toEqual({ mode: 'custom', companyIds: ['company-a'] })
  })

  it('allows internal arbitrary combinations inside access.companyIds without inventing a context', () => {
    const scoped = access({ tenantWide: false })

    expect(isCorporateCompanySelectionAllowed(
      scoped,
      ['company-c', 'company-a'],
      internalSelectionOptions,
    )).toBe(true)
    expect(createCorporateViewSelection(
      scoped,
      ['company-c', 'company-a'],
      internalSelectionOptions,
    )).toEqual({ mode: 'custom', companyIds: ['company-a', 'company-c'] })
    expect(contextForCompanySelection(scoped, ['company-a', 'company-c'])).toBeNull()
    expect(createCorporateViewSelection(
      scoped,
      scoped.companyIds,
      internalSelectionOptions,
    )).toEqual({ mode: 'all', companyIds: [] })
  })

  it('preserves explicit group intent when that context covers the complete access scope', () => {
    const summary = access({
      tenantWide: false,
      companyIds: ['company-a', 'company-b'],
      companies: access().companies.slice(0, 2),
      contexts: access().contexts.filter((context) => context.id !== 'company-c'),
    })

    expect(createCorporateViewSelection(
      summary,
      summary.companyIds,
      internalSelectionOptions,
    )).toEqual({ mode: 'all', companyIds: [] })
    const contextSelection = createCorporateContextViewSelection(summary, 'group', 'group-a')
    const context = contextForCompanySelection(summary, contextSelection?.companyIds || [])
    expect(contextSelection).toEqual({ mode: 'custom', companyIds: ['company-a', 'company-b'] })
    expect(context?.id).toBe('group-a')
    expect(corporateSelectionLabel(summary, contextSelection?.companyIds || [], {
      selectionMode: contextSelection?.mode,
      context,
    })).toBe('Visao consolidada - Grupo Alpha (2)')
  })

  it('allows all mode only when one authorized context covers the complete scope', () => {
    const summary = access({
      companyIds: ['company-a', 'company-b'],
      companies: access().companies.slice(0, 2),
      contexts: access().contexts.filter((context) => context.id !== 'company-c'),
    })

    expect(canSelectAllCompanies(summary)).toBe(true)
    expect(createCorporateViewSelection(summary, ['company-b', 'company-a']))
      .toEqual({ mode: 'all', companyIds: [] })
  })

  it('rejects companies outside the effective access scope', () => {
    const scoped = access({ tenantWide: false })

    expect(createCorporateViewSelection(scoped, ['company-a', 'company-unknown'])).toBeNull()
    expect(createCorporateViewSelection(scoped, ['company-unknown'])).toBeNull()
    expect(createCorporateViewSelection(
      scoped,
      ['company-a', 'company-unknown'],
      internalSelectionOptions,
    )).toBeNull()
    expect(createCorporateViewSelection(
      scoped,
      ['company-unknown'],
      internalSelectionOptions,
    )).toBeNull()
  })

  it('derives a legacy context only for exact company or consolidated group selections', () => {
    const summary = access()
    expect(contextForCompanySelection(summary, ['company-b'])?.id).toBe('company-b')
    expect(contextForCompanySelection(summary, ['company-a', 'company-b'])?.id).toBe('group-a')
    expect(contextForCompanySelection(summary, ['company-a', 'company-c'])).toBeNull()
  })

  it('rejects a multi-company selection without an authorized consolidated group', () => {
    const scoped = access({
      tenantWide: false,
      groups: access().groups.map((group) => ({ ...group, canViewConsolidated: false })),
      contexts: access().contexts.map((context) => (
        context.type === 'group' ? { ...context, canViewConsolidated: false } : context
      )),
    })

    expect(createCorporateViewSelection(scoped, ['company-a', 'company-b']))
      .toBeNull()
    expect(createCorporateContextViewSelection(scoped, 'group', 'group-a')).toBeNull()
    expect(contextForCompanySelection(scoped, ['company-a', 'company-b'])).toBeNull()
  })

  it('matches names without depending on accents or casing', () => {
    expect(matchesCorporateContextSearch('Empresa Árvore', 'arvore')).toBe(true)
    expect(matchesCorporateContextSearch('Grupo Alpha', 'ALPHA')).toBe(true)
    expect(matchesCorporateContextSearch('Empresa Brasil', 'servicos')).toBe(false)
  })
})
