import { describe, expect, it } from 'vitest'

import {
  canSelectAllCompanies,
  contextForCompanySelection,
  corporateSelectionLabel,
  createCorporateViewSelection,
  defaultCorporateViewSelection,
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
  it('opens tenant-wide access with every current company selected', () => {
    const summary = access()
    const selection = defaultCorporateViewSelection(summary)

    expect(selection).toEqual({ mode: 'all', companyIds: [] })
    expect(selectedCompanyIdsForSelection(summary, selection)).toEqual(summary.companyIds)
    expect(corporateSelectionLabel(summary, summary.companyIds)).toBe('Todas as empresas (3)')
  })

  it('keeps all mode dynamic and custom mode explicit when access changes', () => {
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
    )).toEqual(['company-a', 'company-b', 'company-c', 'company-d'])
    expect(reconcileCorporateViewSelection(
      expanded,
      customSelection,
    )).toEqual({ mode: 'custom', companyIds: ['company-b'] })
  })

  it('opens scoped access with every authorized company selected', () => {
    const scoped = access({ tenantWide: false })

    expect(defaultCorporateViewSelection(scoped))
      .toEqual({ mode: 'all', companyIds: [] })
    expect(selectedCompanyIdsForSelection(scoped, defaultCorporateViewSelection(scoped)))
      .toEqual(scoped.companyIds)
    expect(canSelectAllCompanies(scoped)).toBe(true)
  })

  it('normalizes an explicit full selection back to all mode', () => {
    const summary = access()
    expect(createCorporateViewSelection(summary, ['company-c', 'company-a', 'company-b']))
      .toEqual({ mode: 'all', companyIds: [] })
  })

  it('allows any non-empty subset inside the effective access scope', () => {
    const scoped = access({ tenantWide: false })
    expect(canSelectAllCompanies(scoped)).toBe(true)
    expect(createCorporateViewSelection(scoped, ['company-a', 'company-b']))
      .toEqual({ mode: 'custom', companyIds: ['company-a', 'company-b'] })
    expect(createCorporateViewSelection(scoped, ['company-a', 'company-c']))
      .toEqual({ mode: 'custom', companyIds: ['company-a', 'company-c'] })
    expect(createCorporateViewSelection(scoped, scoped.companyIds))
      .toEqual({ mode: 'all', companyIds: [] })
  })

  it('rejects companies outside the effective access scope', () => {
    const scoped = access({ tenantWide: false })

    expect(createCorporateViewSelection(scoped, ['company-a', 'company-unknown'])).toBeNull()
    expect(createCorporateViewSelection(scoped, ['company-unknown'])).toBeNull()
  })

  it('derives a legacy context only for exact company or consolidated group selections', () => {
    const summary = access()
    expect(contextForCompanySelection(summary, ['company-b'])?.id).toBe('company-b')
    expect(contextForCompanySelection(summary, ['company-a', 'company-b'])?.id).toBe('group-a')
    expect(contextForCompanySelection(summary, ['company-a', 'company-c'])).toBeNull()
  })

  it('keeps a multi-company filter valid without inferring a non-consolidated group context', () => {
    const scoped = access({
      tenantWide: false,
      groups: access().groups.map((group) => ({ ...group, canViewConsolidated: false })),
      contexts: access().contexts.map((context) => (
        context.type === 'group' ? { ...context, canViewConsolidated: false } : context
      )),
    })

    expect(createCorporateViewSelection(scoped, ['company-a', 'company-b']))
      .toEqual({ mode: 'custom', companyIds: ['company-a', 'company-b'] })
    expect(contextForCompanySelection(scoped, ['company-a', 'company-b'])).toBeNull()
  })

  it('matches names without depending on accents or casing', () => {
    expect(matchesCorporateContextSearch('Empresa Árvore', 'arvore')).toBe(true)
    expect(matchesCorporateContextSearch('Grupo Alpha', 'ALPHA')).toBe(true)
    expect(matchesCorporateContextSearch('Empresa Brasil', 'servicos')).toBe(false)
  })
})
