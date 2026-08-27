import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import {
  resolveAnyEnabledCompanyPortalContextCompanyIds,
  resolveCompanyPortalResourceCompanyId,
} from '@/lib/server/company-portal-scope-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { CorporateAccessSummary, User } from '@/types'

describe('offline Portal Empresa company boundary', () => {
  it('rejects a corporate resource in a company whose Portal Empresa is disabled', () => {
    const principal = corporatePrincipal()

    expect(() => resolveCompanyPortalResourceCompanyId(
      principal,
      'company-disabled',
      'ver_reservas',
    )).toThrowError(expect.objectContaining({
      code: 'COMPANY_PORTAL_COMPANY_SCOPE_DENIED',
    }))
  })

  it('uses the resource company instead of a stale default client context', () => {
    const principal = corporatePrincipal()

    expect(resolveCompanyPortalResourceCompanyId(
      principal,
      'company-enabled',
      'ver_reservas',
    )).toBe('company-enabled')
  })

  it('preserves internal agency access when the company portal is disabled', () => {
    const principal = corporatePrincipal({
      role: 'master',
      role_key: 'agent',
      corporate_profile: undefined,
    })

    expect(resolveCompanyPortalResourceCompanyId(
      principal,
      'company-disabled',
      'ver_reservas',
    )).toBe('company-disabled')
  })

  it('preserves a scoped support-assisted action by an internal agency actor', () => {
    const principal = corporatePrincipal()
    principal.actor = {
      sessionId: 'actor-session',
      membershipId: 'actor-membership',
      roleKey: 'agent',
      platformAdmin: false,
      user: {
        ...principal.user,
        id: '00000000-0000-4000-8000-000000000002',
        email: 'agent@example.test',
        name: 'Agency agent',
        role: 'master',
        role_key: 'agent',
        corporate_profile: undefined,
      },
    }

    expect(resolveCompanyPortalResourceCompanyId(
      principal,
      'company-disabled',
      'criar_demandas',
    )).toBe('company-disabled')
  })

  it('requires an enabled corporate context for the tenant-wide ground catalog', () => {
    const principal = corporatePrincipal()
    expect(resolveAnyEnabledCompanyPortalContextCompanyIds(principal, 'ver_demandas'))
      .toEqual(['company-enabled'])

    const disabled = corporatePrincipal()
    disabled.corporateAccess!.companies = disabled.corporateAccess!.companies.map((company) => ({
      ...company,
      companyPortalEnabled: false,
    }))
    disabled.user.corporate_access = disabled.corporateAccess

    expect(() => resolveAnyEnabledCompanyPortalContextCompanyIds(disabled, 'ver_demandas'))
      .toThrowError(expect.objectContaining({ code: 'COMPANY_PORTAL_SCOPE_EMPTY' }))
  })

  it('keeps the tenant-wide ground catalog available to internal agency users', () => {
    const principal = corporatePrincipal({
      role: 'master',
      role_key: 'agent',
      corporate_profile: undefined,
    })
    principal.corporateAccess!.companies = principal.corporateAccess!.companies.map((company) => ({
      ...company,
      companyPortalEnabled: false,
    }))
    principal.user.corporate_access = principal.corporateAccess

    expect(resolveAnyEnabledCompanyPortalContextCompanyIds(principal, 'ver_demandas'))
      .toEqual(['company-disabled', 'company-enabled'])
  })

  it('wires every corporate quote read and selection after loading the server-owned company', () => {
    const hotel = source('lib/server/offline-quote-service.ts')
    const air = source('lib/server/offline-air-quote-service.ts')
    const ground = source('lib/server/offline-ground-quote-service.ts')
    const catalog = source('lib/server/offline-ground-catalog-service.ts')

    const hotelList = section(hotel, 'export async function listOfflineHotelQuotes', 'async function loadOfflineHotelQuoteById')
    const selection = section(hotel, 'async function prepareSelection', 'async function persistSelection')
    const airList = section(air, 'export async function listOfflineAirQuotes', 'async function prepareAirQuote')
    const groundList = section(ground, 'export async function listOfflineGroundQuotes', 'export async function listOfflineGroundQuoteCatalog')

    for (const implementation of [hotelList, airList, groundList]) {
      expect(implementation).toContain(
        "resolveCompanyPortalResourceCompanyId(principal, demand.company_id, 'ver_reservas')",
      )
      expect(implementation.indexOf('resolveCompanyPortalResourceCompanyId'))
        .toBeLessThan(implementation.indexOf('assertRequesterOwnsDemand'))
    }
    expect(selection).toContain(
      "resolveCompanyPortalResourceCompanyId(principal, demand.company_id, 'criar_demandas')",
    )
    expect(selection.indexOf('loadQuoteDemand'))
      .toBeLessThan(selection.indexOf('resolveCompanyPortalResourceCompanyId'))
    expect(selection.indexOf('resolveCompanyPortalResourceCompanyId'))
      .toBeLessThan(selection.indexOf('authorizeSelectionActor'))
    expect(catalog).toContain(
      "resolveAnyEnabledCompanyPortalContextCompanyIds(principal, 'ver_demandas')",
    )
  })
})

function source(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
}

function section(value: string, start: string, end: string): string {
  const startAt = value.indexOf(start)
  const endAt = value.indexOf(end, startAt + start.length)
  expect(startAt, `inicio ausente: ${start}`).toBeGreaterThanOrEqual(0)
  expect(endAt, `fim ausente: ${end}`).toBeGreaterThan(startAt)
  return value.slice(startAt, endAt)
}

function corporatePrincipal(userOverrides: Partial<User> = {}): RequestPrincipal {
  const permissions = permissionsForCorporateProfile('requester', {})
  const corporateAccess: CorporateAccessSummary = {
    tenantWide: false,
    companyIds: ['company-disabled', 'company-enabled'],
    groupIds: [],
    companies: [
      {
        companyId: 'company-disabled',
        companyName: 'Empresa desabilitada',
        companyPortalEnabled: false,
        groupId: null,
        groupName: null,
        sources: ['direct'],
        profiles: ['requester'],
        permissions,
      },
      {
        companyId: 'company-enabled',
        companyName: 'Empresa habilitada',
        companyPortalEnabled: true,
        groupId: null,
        groupName: null,
        sources: ['direct'],
        profiles: ['requester'],
        permissions,
      },
    ],
    groups: [],
    contexts: [
      {
        type: 'company',
        id: 'company-disabled',
        label: 'Empresa desabilitada',
        groupId: null,
        companyIds: ['company-disabled'],
        canViewConsolidated: false,
      },
      {
        type: 'company',
        id: 'company-enabled',
        label: 'Empresa habilitada',
        groupId: null,
        companyIds: ['company-enabled'],
        canViewConsolidated: false,
      },
    ],
    defaultContext: { type: 'company', id: 'company-disabled' },
    refreshedAt: '2026-08-27T12:00:00.000Z',
  }
  const user: User = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'corporate@example.test',
    name: 'Corporate user',
    role: 'colaborador',
    role_key: 'requester',
    company_id: 'company-disabled',
    empresa_ids: [...corporateAccess.companyIds],
    grupo_ids: [],
    corporate_profile: 'requester',
    corporate_access: corporateAccess,
    permissoes: permissions,
    ...userOverrides,
  }
  return {
    sessionId: 'session-a',
    tenantId: 'tenant-a',
    tenantSlug: 'tenant-a',
    tenantStatus: 'active',
    membershipId: 'membership-a',
    roleKey: user.role_key || 'requester',
    platformAdmin: false,
    planKey: null,
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    corporateAccess,
    user,
  }
}
