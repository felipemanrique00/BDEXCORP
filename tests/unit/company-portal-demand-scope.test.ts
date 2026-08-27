import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import { resolveCompanyPortalDemandScopeCompanyIds } from '@/lib/server/company-portal-demand-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { CorporateAccessSummary, User } from '@/types'

describe('company portal demand scope', () => {
  it('limits a consolidated group to its own companies', () => {
    const principal = requesterPrincipal()

    expect(resolveCompanyPortalDemandScopeCompanyIds(principal, {
      scopeType: 'group',
      scopeId: 'group-a',
    })).toEqual(['company-a', 'company-b'])
  })

  it('accepts a company filter only inside the selected group', () => {
    const principal = requesterPrincipal()

    expect(resolveCompanyPortalDemandScopeCompanyIds(principal, {
      scopeType: 'group',
      scopeId: 'group-a',
      companyId: 'company-b',
    })).toEqual(['company-b'])

    expect(() => resolveCompanyPortalDemandScopeCompanyIds(principal, {
      scopeType: 'group',
      scopeId: 'group-a',
      companyId: 'company-c',
    })).toThrowError(expect.objectContaining({
      code: 'COMPANY_PORTAL_COMPANY_SCOPE_DENIED',
      status: 403,
    }))
  })

  it('falls back to the corporate default context instead of the tenant scope', () => {
    const principal = requesterPrincipal()

    expect(resolveCompanyPortalDemandScopeCompanyIds(principal)).toEqual(['company-a', 'company-b'])
  })

  it('remove empresas desabilitadas do contexto do Portal Empresa', () => {
    const principal = requesterPrincipal()
    principal.corporateAccess!.companies = principal.corporateAccess!.companies.map((company) => ({
      ...company,
      companyPortalEnabled: company.companyId !== 'company-b',
    }))
    principal.user.corporate_access = principal.corporateAccess

    expect(resolveCompanyPortalDemandScopeCompanyIds(principal, {
      scopeType: 'group',
      scopeId: 'group-a',
    })).toEqual(['company-a'])
    expect(() => resolveCompanyPortalDemandScopeCompanyIds(principal, {
      scopeType: 'group',
      scopeId: 'group-a',
      companyId: 'company-b',
    })).toThrowError(expect.objectContaining({
      code: 'COMPANY_PORTAL_COMPANY_SCOPE_DENIED',
    }))
  })

  it('falha fechado quando todo o contexto corporativo esta desabilitado no Portal Empresa', () => {
    const principal = requesterPrincipal()
    principal.corporateAccess!.companies = principal.corporateAccess!.companies.map((company) => ({
      ...company,
      companyPortalEnabled: false,
    }))
    principal.user.corporate_access = principal.corporateAccess

    expect(() => resolveCompanyPortalDemandScopeCompanyIds(principal, {
      scopeType: 'group',
      scopeId: 'group-a',
    })).toThrowError(expect.objectContaining({
      code: 'COMPANY_PORTAL_SCOPE_EMPTY',
    }))
  })

  it('fails closed for a corporate user without an authorized context', () => {
    const principal = requesterPrincipal({
      defaultContext: null,
      contexts: [],
    })

    expect(() => resolveCompanyPortalDemandScopeCompanyIds(principal)).toThrowError(
      expect.objectContaining({
        code: 'COMPANY_PORTAL_CONTEXT_SCOPE_DENIED',
        status: 403,
      }),
    )
  })

  it('keeps an internal portal test session on its existing authorized companies', () => {
    const principal = requesterPrincipal({}, {
      role: 'master',
      role_key: 'agent',
      corporate_profile: undefined,
    })
    principal.corporateAccess!.companies = principal.corporateAccess!.companies.map((company) => ({
      ...company,
      companyPortalEnabled: false,
    }))
    principal.user.corporate_access = principal.corporateAccess

    expect(resolveCompanyPortalDemandScopeCompanyIds(principal)).toEqual([
      'company-a',
      'company-b',
      'company-c',
    ])
  })

  it('enforces requester ownership after the company scope in the relational query', () => {
    const demandService = source('lib/server/demand-service.ts')
    const portalService = source('lib/server/company-portal-demand-service.ts')
    const detailRoute = source('app/api/company-portal/demands/[id]/route.ts')

    expect(demandService).toContain("clauses.push(requesterOwnDemandExistsSql('demand'")
    expect(demandService).toContain('demand.company_id = any($2::text[])')
    expect(portalService).toContain('getScopedCompanyPortalDemand')
    expect(portalService).toContain("return new DemandServiceError('DEMAND_NOT_FOUND'")
    expect(detailRoute).toContain('getScopedCompanyPortalDemand')
    expect(portalService).toContain(
      'if (error instanceof CorporateAccessDeniedError) throw companyPortalDemandNotFound()',
    )
    const scopedGetter = portalService.slice(
      portalService.indexOf('export async function getScopedCompanyPortalDemand'),
      portalService.indexOf('export function resolveCompanyPortalDemandScopeCompanyIds'),
    )
    expect(scopedGetter.indexOf('resolveCompanyPortalDemandScopeCompanyIds'))
      .toBeLessThan(scopedGetter.indexOf('getCompanyPortalDemand'))
  })

  it('ignores a stale Kanban response after the corporate context changes', () => {
    const portal = source('components/company-portal-lab/company-portal-lab.tsx')

    expect(portal).toContain('const demandListRequestSequence = useRef(0)')
    expect(portal).toContain('demandListRequestSequence.current !== requestSequence')
    expect(portal).toContain('demandListRequestSequence.current === requestSequence')
  })

  it('binds demand creation and correction to the selected context', () => {
    const portalService = source('lib/server/company-portal-demand-service.ts')
    const listRoute = source('app/api/company-portal/demands/route.ts')
    const detailRoute = source('app/api/company-portal/demands/[id]/route.ts')
    const client = source('lib/company-portal-lab/demand-client.ts')
    const airForm = source('components/company-portal-lab/air-offline-request-form.tsx')
    const hotelForm = source('components/company-portal-lab/hotel-offline-request-form.tsx')
    const groundForm = source('components/company-portal-lab/ground-offline-request-form.tsx')

    expect(listRoute).toContain('scopeQuerySchema.parse')
    expect(listRoute).toContain('input.body,')
    expect(listRoute).toContain('scope,')
    expect(detailRoute).toContain('updateCompanyPortalDemand(guard.principal!, id, input.body, scope)')
    expect(listRoute).toContain("permissionsAll: ['criar_demandas', 'ver_demandas']")
    expect(detailRoute).toContain("permissionsAll: ['criar_demandas', 'ver_demandas']")
    expect(portalService).toContain('resolveCompanyPortalDemandWriteScopeCompanyIds(principal, scope)')
    expect(portalService).toContain("resolveCompanyPortalScopeCompanyIds(principal, scope, 'criar_demandas')")
    expect(portalService).toContain("resolveCompanyPortalScopeCompanyIds(principal, scope, 'ver_demandas')")
    expect(portalService).toContain('if (!companyIds.includes(companyId)) throw companyPortalDemandNotFound()')
    expect(portalService).toContain('if (!companyIds.includes(current.companyId)) throw companyPortalDemandNotFound()')
    expect(portalService).toContain('allowedCompanyIds: companyIds')
    expect(client).toContain('/api/company-portal/demands${queryString(scope)}')
    for (const form of [airForm, hotelForm, groundForm]) {
      expect(form).toContain('createCompanyPortalDemand(demand, demandScope)')
      expect(form).toContain('updateCompanyPortalDemand(editingItem.id')
      expect(form).toContain('}, demandScope)')
    }
  })
})

function requesterPrincipal(
  accessOverrides: Partial<CorporateAccessSummary> = {},
  userOverrides: Partial<User> = {},
): RequestPrincipal {
  const permissions = permissionsForCorporateProfile('requester', {
    ver_demandas: true,
    ver_empresas: true,
    ver_consolidado_grupo: true,
  })
  const corporateAccess: CorporateAccessSummary = {
    tenantWide: false,
    companyIds: ['company-a', 'company-b', 'company-c'],
    groupIds: ['group-a', 'group-b'],
    companies: [
      { companyId: 'company-a', companyName: 'Empresa A', groupId: 'group-a', groupName: 'Grupo A', sources: ['group_all'], profiles: ['requester'], permissions },
      { companyId: 'company-b', companyName: 'Empresa B', groupId: 'group-a', groupName: 'Grupo A', sources: ['group_all'], profiles: ['requester'], permissions },
      { companyId: 'company-c', companyName: 'Empresa C', groupId: 'group-b', groupName: 'Grupo B', sources: ['group_all'], profiles: ['requester'], permissions },
    ],
    groups: [
      { groupId: 'group-a', groupName: 'Grupo A', companyIds: ['company-a', 'company-b'], canViewConsolidated: true, accessModes: ['all_companies'], profiles: ['requester'] },
      { groupId: 'group-b', groupName: 'Grupo B', companyIds: ['company-c'], canViewConsolidated: true, accessModes: ['all_companies'], profiles: ['requester'] },
    ],
    contexts: [
      { type: 'group', id: 'group-a', label: 'Grupo A', groupId: 'group-a', companyIds: ['company-a', 'company-b'], canViewConsolidated: true },
      { type: 'group', id: 'group-b', label: 'Grupo B', groupId: 'group-b', companyIds: ['company-c'], canViewConsolidated: true },
      { type: 'company', id: 'company-a', label: 'Empresa A', groupId: 'group-a', companyIds: ['company-a'], canViewConsolidated: false },
      { type: 'company', id: 'company-b', label: 'Empresa B', groupId: 'group-a', companyIds: ['company-b'], canViewConsolidated: false },
      { type: 'company', id: 'company-c', label: 'Empresa C', groupId: 'group-b', companyIds: ['company-c'], canViewConsolidated: false },
    ],
    defaultContext: { type: 'group', id: 'group-a' },
    refreshedAt: '2026-08-17T12:00:00.000Z',
    ...accessOverrides,
  }
  const user: User = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'requester@example.com',
    name: 'Requester',
    role: 'colaborador',
    role_key: 'requester',
    company_id: 'company-a',
    corporate_profile: 'requester',
    corporate_access: corporateAccess,
    ...userOverrides,
  }
  return {
    tenantId: 'tenant-a',
    roleKey: user.role_key || 'requester',
    platformAdmin: false,
    corporateAccess,
    user,
  } as RequestPrincipal
}

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}
