import { describe, expect, it } from 'vitest'

import {
  resolveCompanyPortalBoardBrandingScope,
  resolveCompanyPortalInitialCompanyId,
} from '@/lib/company-portal-lab/branding-scope'

describe('Company Portal branding scope', () => {
  it('uses the only visible company on the board and keeps it when opening a request', () => {
    const input = { companyIds: ['company-a'], context: null, companyFilter: '' }

    expect(resolveCompanyPortalBoardBrandingScope(input)).toEqual({ type: 'company', id: 'company-a' })
    expect(resolveCompanyPortalInitialCompanyId(input)).toBe('company-a')
  })

  it('gives the board filter precedence over a different company context', () => {
    const input = {
      companyIds: ['company-a', 'company-b'],
      context: { type: 'company' as const, id: 'company-a' },
      companyFilter: 'company-b',
    }

    expect(resolveCompanyPortalBoardBrandingScope(input)).toEqual({ type: 'company', id: 'company-b' })
    expect(resolveCompanyPortalInitialCompanyId(input)).toBe('company-b')
  })

  it('uses the active company context when there is no local filter', () => {
    const input = {
      companyIds: ['company-a', 'company-b'],
      context: { type: 'company' as const, id: 'company-b' },
      companyFilter: '',
    }

    expect(resolveCompanyPortalBoardBrandingScope(input)).toEqual({ type: 'company', id: 'company-b' })
    expect(resolveCompanyPortalInitialCompanyId(input)).toBe('company-b')
  })

  it('uses the authorized group branding for a consolidated multi-company board', () => {
    const input = {
      companyIds: ['company-a', 'company-b'],
      context: { type: 'group' as const, id: 'group-a' },
      companyFilter: '',
    }

    expect(resolveCompanyPortalBoardBrandingScope(input)).toEqual({ type: 'group', id: 'group-a' })
    expect(resolveCompanyPortalInitialCompanyId(input)).toBe('company-a')
  })

  it('gives an explicit company filter precedence over the active group', () => {
    const input = {
      companyIds: ['company-a', 'company-b'],
      context: { type: 'group' as const, id: 'group-a' },
      companyFilter: 'company-b',
    }

    expect(resolveCompanyPortalBoardBrandingScope(input)).toEqual({ type: 'company', id: 'company-b' })
  })

  it('ignores stale or unauthorized company ids', () => {
    const input = {
      companyIds: ['company-a'],
      context: { type: 'company' as const, id: 'company-stale' },
      companyFilter: 'company-forbidden',
    }

    expect(resolveCompanyPortalBoardBrandingScope(input)).toEqual({ type: 'company', id: 'company-a' })
    expect(resolveCompanyPortalInitialCompanyId(input)).toBe('company-a')
  })
})
