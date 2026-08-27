import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  requireCompanyAccess: vi.fn(),
  withTenantTransaction: vi.fn(),
}))

vi.mock('@/lib/server/corporate-access-service', () => ({
  requireCompanyAccess: mocks.requireCompanyAccess,
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

import { getRequesterSelfProfile } from '@/lib/server/requester-self-profile-service'

describe('requester self-profile service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireCompanyAccess.mockResolvedValue(undefined)
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) => (
        operation({ query: mocks.query })
      ),
    )
  })

  it('loads the active global user through the tenant membership and exact company', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ id: 'requester-a', name: 'Solicitante Teste', email: 'requester@example.com' }],
    })

    const result = await getRequesterSelfProfile(principal(), 'company-a')

    expect(mocks.requireCompanyAccess).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      'company-a',
      'criar_demandas',
    )
    expect(result).toEqual({
      id: 'requester-a',
      name: 'Solicitante Teste',
      email: 'requester@example.com',
      hasActivePortalAccess: true,
    })
    expect(mocks.query).toHaveBeenCalledTimes(1)
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toContain('portal_user.tenant_id')
    expect(sql).toContain('portal_user.id = requester.user_id')
    expect(sql).toContain("portal_user.status = 'active'")
    expect(sql).toContain('portal_user.deleted_at is null')
    expect(sql).toContain('membership.tenant_id = requester.tenant_id')
    expect(sql).toContain('membership.user_id = requester.user_id')
    expect(sql).toContain("membership.status = 'active'")
    expect(sql).toContain('requester.company_id = $2')
    expect(values).toEqual(['tenant-a', 'company-a', 'user-a'])
  })

  it('fails closed when the canonical requester is absent', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] })

    await expect(getRequesterSelfProfile(principal(), 'company-a')).resolves.toBeNull()
  })
})

function principal(): RequestPrincipal {
  return {
    tenantId: 'tenant-a',
    user: { id: 'user-a' },
  } as RequestPrincipal
}
