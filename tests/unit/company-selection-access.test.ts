import { describe, expect, it } from 'vitest'

import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import {
  requireCompanySelectionAccess,
} from '@/lib/server/corporate-access-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type {
  CorporateAccessSummary,
  CorporateContextOption,
  Permissoes,
} from '@/types'

interface PrincipalOptions {
  tenantWide?: boolean
  groupACanViewConsolidated?: boolean
  groupAContextCompanyIds?: string[]
  companyBPermissions?: Permissoes
}

describe('requireCompanySelectionAccess', () => {
  it('normalizes, removes duplicates and preserves the requested order', async () => {
    await expect(requireCompanySelectionAccess(
      principal(),
      [' company-b ', 'company-a', 'company-b', '   '],
      'ver_reservas',
    )).resolves.toEqual(['company-b', 'company-a'])
  })

  it('allows one authorized company without consolidated group access', async () => {
    await expect(requireCompanySelectionAccess(
      principal({ groupACanViewConsolidated: false }),
      ['company-a'],
      'ver_reservas',
    )).resolves.toEqual(['company-a'])
  })

  it('allows multiple companies covered by the same consolidated group', async () => {
    await expect(requireCompanySelectionAccess(
      principal(),
      ['company-a', 'company-b'],
      'ver_reservas',
    )).resolves.toEqual(['company-a', 'company-b'])
  })

  it('denies a non-tenant-wide selection spanning different groups', async () => {
    await expect(requireCompanySelectionAccess(
      principal(),
      ['company-a', 'company-c'],
      'ver_reservas',
    )).rejects.toMatchObject({ code: 'COMPANY_SELECTION_CONSOLIDATED_DENIED' })
  })

  it('denies multiple companies when their group cannot be viewed as consolidated', async () => {
    await expect(requireCompanySelectionAccess(
      principal({ groupACanViewConsolidated: false }),
      ['company-a', 'company-b'],
      'ver_reservas',
    )).rejects.toMatchObject({ code: 'COMPANY_SELECTION_CONSOLIDATED_DENIED' })
  })

  it('uses the effective consolidated context instead of the broader group grant', async () => {
    await expect(requireCompanySelectionAccess(
      principal({ groupAContextCompanyIds: ['company-a'] }),
      ['company-a', 'company-b'],
      'ver_reservas',
    )).rejects.toMatchObject({ code: 'COMPANY_SELECTION_CONSOLIDATED_DENIED' })
  })

  it('allows a tenant-wide selection spanning different groups', async () => {
    await expect(requireCompanySelectionAccess(
      principal({ tenantWide: true }),
      ['company-a', 'company-c'],
      'ver_reservas',
    )).resolves.toEqual(['company-a', 'company-c'])
  })

  it('denies a company outside the effective corporate access', async () => {
    await expect(requireCompanySelectionAccess(
      principal({ tenantWide: true }),
      ['company-a', 'company-unknown'],
      'ver_reservas',
    )).rejects.toMatchObject({ code: 'COMPANY_ACCESS_DENIED' })
  })

  it('denies the whole selection when one company lacks the requested permission', async () => {
    const deniedPermissions = {
      ...permissionsForCorporateProfile('group_admin', {}),
      ver_reservas: false,
    }

    await expect(requireCompanySelectionAccess(
      principal({ companyBPermissions: deniedPermissions }),
      ['company-a', 'company-b'],
      'ver_reservas',
    )).rejects.toMatchObject({ code: 'COMPANY_PERMISSION_DENIED' })
  })

  it('returns an empty scope for an empty normalized request', async () => {
    await expect(requireCompanySelectionAccess(
      principal(),
      ['', '   '],
      'ver_reservas',
    )).resolves.toEqual([])
  })
})

function principal(options: PrincipalOptions = {}): RequestPrincipal {
  const permissions = permissionsForCorporateProfile('group_admin', {})
  const groupACanViewConsolidated = options.groupACanViewConsolidated ?? true
  const contexts: CorporateContextOption[] = [
    ...(groupACanViewConsolidated ? [{
      type: 'group' as const,
      id: 'group-a',
      label: 'Visao consolidada - Grupo A',
      groupId: 'group-a',
      companyIds: options.groupAContextCompanyIds ?? ['company-a', 'company-b'],
      canViewConsolidated: true,
    }] : []),
    {
      type: 'group',
      id: 'group-b',
      label: 'Visao consolidada - Grupo B',
      groupId: 'group-b',
      companyIds: ['company-c'],
      canViewConsolidated: true,
    },
    ...['company-a', 'company-b', 'company-c'].map((companyId): CorporateContextOption => ({
      type: 'company',
      id: companyId,
      label: `Empresa ${companyId.slice(-1).toUpperCase()}`,
      groupId: companyId === 'company-c' ? 'group-b' : 'group-a',
      companyIds: [companyId],
      canViewConsolidated: false,
    })),
  ]
  const corporateAccess: CorporateAccessSummary = {
    tenantWide: options.tenantWide ?? false,
    companyIds: ['company-a', 'company-b', 'company-c'],
    groupIds: ['group-a', 'group-b'],
    companies: [
      {
        companyId: 'company-a',
        companyName: 'Empresa A',
        groupId: 'group-a',
        groupName: 'Grupo A',
        sources: ['group_all'],
        profiles: ['group_admin'],
        permissions,
      },
      {
        companyId: 'company-b',
        companyName: 'Empresa B',
        groupId: 'group-a',
        groupName: 'Grupo A',
        sources: ['group_all'],
        profiles: ['group_admin'],
        permissions: options.companyBPermissions ?? permissions,
      },
      {
        companyId: 'company-c',
        companyName: 'Empresa C',
        groupId: 'group-b',
        groupName: 'Grupo B',
        sources: ['group_all'],
        profiles: ['group_admin'],
        permissions,
      },
    ],
    groups: [
      {
        groupId: 'group-a',
        groupName: 'Grupo A',
        companyIds: ['company-a', 'company-b'],
        canViewConsolidated: groupACanViewConsolidated,
        accessModes: ['all_companies'],
        profiles: ['group_admin'],
      },
      {
        groupId: 'group-b',
        groupName: 'Grupo B',
        companyIds: ['company-c'],
        canViewConsolidated: true,
        accessModes: ['all_companies'],
        profiles: ['group_admin'],
      },
    ],
    contexts,
    defaultContext: { type: 'group', id: 'group-a' },
    refreshedAt: new Date(0).toISOString(),
  }

  return {
    sessionId: 'session-a',
    tenantId: 'tenant-a',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: options.tenantWide ? 'tenant_admin' : 'company_admin',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess,
    user: {
      id: 'user-a',
      email: 'admin@example.test',
      name: 'Administrador',
      role: options.tenantWide ? 'master' : 'company_admin',
      company_id: 'company-a',
      ativo: true,
      permissoes: permissions,
      corporate_access: corporateAccess,
    },
  }
}
