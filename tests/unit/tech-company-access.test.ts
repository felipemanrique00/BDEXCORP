import { describe, expect, it } from 'vitest'

import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import {
  IntegrationCompanyMappingError,
  selectAuthorizedCompanyForIntegration,
} from '@/lib/server/integration-company-mapping-service'
import type { RequestPrincipal } from '@/lib/server/request-context'

describe('Tech company access resolution', () => {
  it('uses the requested company only when that company grants the permission', () => {
    const principal = buildPrincipal([
      company('company-a', true),
      company('company-b', false),
    ])

    expect(selectAuthorizedCompanyForIntegration(
      principal,
      'company-a',
      'gerenciar_integracoes',
    )).toBe('company-a')

    expect(() => selectAuthorizedCompanyForIntegration(
      principal,
      'company-b',
      'gerenciar_integracoes',
    )).toThrowError(IntegrationCompanyMappingError)
  })

  it('selects an implicit company only when the authorized scope is unambiguous', () => {
    const oneCompany = buildPrincipal([
      company('company-a', true),
      company('company-b', false),
    ])
    expect(selectAuthorizedCompanyForIntegration(
      oneCompany,
      null,
      'gerenciar_integracoes',
    )).toBe('company-a')

    const twoCompanies = buildPrincipal([
      company('company-a', true),
      company('company-b', true),
    ])
    expect(() => selectAuthorizedCompanyForIntegration(
      twoCompanies,
      null,
      'gerenciar_integracoes',
    )).toThrowError(/Selecione a empresa/)
  })

  it('does not use a global permission to expand a scoped corporate grant', () => {
    const principal = buildPrincipal([company('company-a', false)])
    principal.user.permissoes = {
      ...principal.user.permissoes!,
      gerenciar_integracoes: true,
    }

    expect(() => selectAuthorizedCompanyForIntegration(
      principal,
      'company-a',
      'gerenciar_integracoes',
    )).toThrowError(/fora do escopo autorizado/)
  })
})

function buildPrincipal(
  companies: NonNullable<RequestPrincipal['corporateAccess']>['companies'],
): RequestPrincipal {
  const permissions = permissionsForCorporateProfile('company_admin', {})
  return {
    sessionId: 'session-a',
    tenantId: 'tenant-a',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: 'company_admin',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess: {
      tenantWide: false,
      companyIds: companies.map((item) => item.companyId),
      groupIds: [],
      companies,
      groups: [],
      contexts: companies.map((item) => ({
        type: 'company',
        id: item.companyId,
        label: item.companyName,
        groupId: null,
        companyIds: [item.companyId],
        canViewConsolidated: false,
      })),
      defaultContext: companies[0] ? { type: 'company', id: companies[0].companyId } : null,
      refreshedAt: '2026-07-23T12:00:00.000Z',
    },
    user: {
      id: 'user-a',
      name: 'Usuario',
      email: 'usuario@empresa.test',
      role: 'company_admin',
      company_id: companies[0]?.companyId || null,
      empresa_ids: companies.map((item) => item.companyId),
      permissoes: permissions,
      ativo: true,
    },
  }
}

function company(
  companyId: string,
  canManageIntegrations: boolean,
): NonNullable<RequestPrincipal['corporateAccess']>['companies'][number] {
  return {
    companyId,
    companyName: companyId,
    groupId: null,
    groupName: null,
    sources: ['direct'],
    profiles: ['company_admin'],
    permissions: {
      ...permissionsForCorporateProfile('company_admin', {}),
      gerenciar_integracoes: canManageIntegrations,
    },
  }
}
