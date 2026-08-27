import { describe, expect, it } from 'vitest'

import {
  COMPANY_PORTAL_ROOT,
  TRAVELER_PORTAL_ROOT,
  corporateDashboardRedirect,
  corporateHomeRoute,
  defaultAuthenticatedRoute,
  isCompanyPortalPath,
  isTravelerPortalPath,
} from '@/lib/company-portal-lab/access-boundary'
import { storageKeysForDashboardPath } from '@/lib/storage-hydration-plan'
import type { User } from '@/types'

const corporateUser = {
  role: 'colaborador' as const,
  role_key: 'requester',
  corporate_profile: 'requester' as const,
}

const agencyUser = {
  role: 'master' as const,
  role_key: 'agent',
  corporate_profile: undefined,
}

const travelerWithDisabledCompany = {
  ...corporateUser,
  ativo: true,
  permissoes: { acessar_portal_viajante: true } as User['permissoes'],
  corporate_access: {
    companies: [{ companyPortalEnabled: false }],
  } as User['corporate_access'],
}

describe('company portal access boundary', () => {
  it('routes corporate users to the isolated company portal after login', () => {
    expect(defaultAuthenticatedRoute(corporateUser)).toBe(COMPANY_PORTAL_ROOT)
    expect(defaultAuthenticatedRoute(agencyUser)).toBe('/dashboard')
    expect(defaultAuthenticatedRoute(travelerWithDisabledCompany)).toBe(TRAVELER_PORTAL_ROOT)
  })

  it('keeps corporate users inside the company portal namespace', () => {
    expect(corporateDashboardRedirect(corporateUser, '/dashboard')).toBe(COMPANY_PORTAL_ROOT)
    expect(corporateDashboardRedirect(corporateUser, '/dashboard/usuarios')).toBe(COMPANY_PORTAL_ROOT)
    expect(corporateDashboardRedirect(corporateUser, '/relatorios/dashboard')).toBe(COMPANY_PORTAL_ROOT)
    expect(corporateDashboardRedirect(corporateUser, COMPANY_PORTAL_ROOT)).toBeNull()
    expect(corporateDashboardRedirect(travelerWithDisabledCompany, TRAVELER_PORTAL_ROOT)).toBeNull()
    expect(corporateDashboardRedirect(corporateUser, TRAVELER_PORTAL_ROOT)).toBe(COMPANY_PORTAL_ROOT)
    expect(corporateDashboardRedirect(travelerWithDisabledCompany, `${TRAVELER_PORTAL_ROOT}/fake`))
      .toBe(TRAVELER_PORTAL_ROOT)
  })

  it('keeps the company portal as home whenever an enabled company context exists', () => {
    const user = {
      ...travelerWithDisabledCompany,
      corporate_access: {
        companies: [{ companyPortalEnabled: false }, { companyPortalEnabled: true }],
      } as User['corporate_access'],
    }
    expect(corporateHomeRoute(user)).toBe(COMPANY_PORTAL_ROOT)
    expect(corporateDashboardRedirect(user, TRAVELER_PORTAL_ROOT)).toBeNull()
  })

  it('does not restrict agency users and rejects lookalike paths', () => {
    expect(corporateDashboardRedirect(agencyUser, '/dashboard/usuarios')).toBeNull()
    expect(isCompanyPortalPath(`${COMPANY_PORTAL_ROOT}/pedido/123`)).toBe(true)
    expect(isCompanyPortalPath(`${COMPANY_PORTAL_ROOT}-fake`)).toBe(false)
    expect(isTravelerPortalPath('/dashboard/minha-viagem')).toBe(true)
    expect(isTravelerPortalPath('/dashboard/minha-viagem-fake')).toBe(false)
    expect(isTravelerPortalPath('/dashboard/minha-viagem/fake')).toBe(false)
  })

  it('does not hydrate legacy operational storage inside the corporate portal', () => {
    expect(storageKeysForDashboardPath(COMPANY_PORTAL_ROOT)).toEqual([])
    expect(storageKeysForDashboardPath('/dashboard/minha-viagem')).toEqual([])
  })
})
