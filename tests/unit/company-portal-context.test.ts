import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import { resolveCompanyPortalContext } from '@/lib/company-portal-lab/portal-context'
import type { CorporateAccessSummary, CorporateContextOption } from '@/types'

describe('shared Portal Empresa context', () => {
  it('falls back from a disabled corporate default to an enabled authorized company', () => {
    const access = fixtureAccess()

    expect(resolveCompanyPortalContext(access, companyContext('company-disabled'), 'corporate'))
      .toMatchObject({ type: 'company', id: 'company-enabled', companyIds: ['company-enabled'] })
  })

  it('intersects a mixed corporate group with portal-enabled companies', () => {
    const access = fixtureAccess()
    const group = access.contexts.find((context) => context.type === 'group')!

    expect(resolveCompanyPortalContext(access, group, 'corporate')).toEqual({
      ...group,
      companyIds: ['company-enabled'],
    })
  })

  it('fails closed when no company is enabled for a corporate session', () => {
    const access = fixtureAccess()
    access.companies = access.companies.map((company) => ({
      ...company,
      companyPortalEnabled: false,
    }))

    expect(resolveCompanyPortalContext(access, companyContext('company-disabled'), 'corporate'))
      .toBeNull()
  })

  it('preserves the complete selected context for the internal agency team', () => {
    const access = fixtureAccess()
    const selected = companyContext('company-disabled')

    expect(resolveCompanyPortalContext(access, selected, 'internal')).toBe(selected)
  })

  it('is consumed by every Portal Empresa section and subflow that calls a scoped API', () => {
    for (const file of [
      'company-portal-lab.tsx',
      'corporate-approvals-section.tsx',
      'corporate-vouchers-section.tsx',
      'corporate-demand-approval-panel.tsx',
      'air-voucher-workspace.tsx',
      'air-offline-request-form.tsx',
      'hotel-offline-request-form.tsx',
      'ground-offline-request-form.tsx',
      'travel-order-builder.tsx',
      'hotel-request-readonly.tsx',
    ]) {
      const source = readFileSync(
        resolve(process.cwd(), 'components/company-portal-lab', file),
        'utf8',
      )
      expect(source, file).toContain('useCompanyPortalContext')
      expect(source, file).not.toContain('defaultCorporateContextOption')
    }
  })
})

function fixtureAccess(): CorporateAccessSummary {
  const permissions = permissionsForCorporateProfile('company_admin', {})
  return {
    tenantWide: false,
    companyIds: ['company-disabled', 'company-enabled'],
    groupIds: ['group-a'],
    companies: [
      {
        companyId: 'company-disabled',
        companyName: 'Empresa desabilitada',
        companyPortalEnabled: false,
        groupId: 'group-a',
        groupName: 'Grupo A',
        sources: ['group_all'],
        profiles: ['company_admin'],
        permissions,
      },
      {
        companyId: 'company-enabled',
        companyName: 'Empresa habilitada',
        companyPortalEnabled: true,
        groupId: 'group-a',
        groupName: 'Grupo A',
        sources: ['group_all'],
        profiles: ['company_admin'],
        permissions,
      },
    ],
    groups: [{
      groupId: 'group-a',
      groupName: 'Grupo A',
      companyIds: ['company-disabled', 'company-enabled'],
      canViewConsolidated: true,
      accessModes: ['all_companies'],
      profiles: ['company_admin'],
    }],
    contexts: [
      companyContext('company-disabled'),
      companyContext('company-enabled'),
      {
        type: 'group',
        id: 'group-a',
        label: 'Grupo A',
        groupId: 'group-a',
        companyIds: ['company-disabled', 'company-enabled'],
        canViewConsolidated: true,
      },
    ],
    defaultContext: { type: 'company', id: 'company-disabled' },
    refreshedAt: '2026-08-27T12:00:00.000Z',
  }
}

function companyContext(companyId: string): CorporateContextOption {
  return {
    type: 'company',
    id: companyId,
    label: companyId,
    groupId: 'group-a',
    companyIds: [companyId],
    canViewConsolidated: false,
  }
}
