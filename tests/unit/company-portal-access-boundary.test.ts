import { describe, expect, it } from 'vitest'

import {
  COMPANY_PORTAL_ROOT,
  corporateDashboardRedirect,
  defaultAuthenticatedRoute,
  isCompanyPortalPath,
} from '@/lib/company-portal-lab/access-boundary'
import { storageKeysForDashboardPath } from '@/lib/storage-hydration-plan'

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

describe('company portal access boundary', () => {
  it('routes corporate users to the isolated company portal after login', () => {
    expect(defaultAuthenticatedRoute(corporateUser)).toBe(COMPANY_PORTAL_ROOT)
    expect(defaultAuthenticatedRoute(agencyUser)).toBe('/dashboard')
  })

  it('keeps corporate users inside the company portal namespace', () => {
    expect(corporateDashboardRedirect(corporateUser, '/dashboard')).toBe(COMPANY_PORTAL_ROOT)
    expect(corporateDashboardRedirect(corporateUser, '/dashboard/usuarios')).toBe(COMPANY_PORTAL_ROOT)
    expect(corporateDashboardRedirect(corporateUser, '/relatorios/dashboard')).toBe(COMPANY_PORTAL_ROOT)
    expect(corporateDashboardRedirect(corporateUser, COMPANY_PORTAL_ROOT)).toBeNull()
  })

  it('does not restrict agency users and rejects lookalike paths', () => {
    expect(corporateDashboardRedirect(agencyUser, '/dashboard/usuarios')).toBeNull()
    expect(isCompanyPortalPath(`${COMPANY_PORTAL_ROOT}/pedido/123`)).toBe(true)
    expect(isCompanyPortalPath(`${COMPANY_PORTAL_ROOT}-fake`)).toBe(false)
  })

  it('does not hydrate legacy operational storage inside the corporate portal', () => {
    expect(storageKeysForDashboardPath(COMPANY_PORTAL_ROOT)).toEqual([])
  })
})
