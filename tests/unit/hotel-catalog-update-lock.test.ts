import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTenantTransaction: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

vi.mock('@/lib/server/audit-log', () => ({
  writeAuditEvent: vi.fn(),
}))

import { updateHotelCatalog } from '@/lib/server/hotel-catalog-service'

describe('hotel catalog update row lock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, callback: (client: { query: typeof mocks.query }) => unknown) => (
        callback({ query: mocks.query })
      ),
    )
  })

  it('locks only the hotel row without combining FOR UPDATE with a window projection', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ version: '2' }] })

    await expect(updateHotelCatalog(principal(), 'hotel-jw-rio', {
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'STALE_HOTEL_VERSION',
      status: 409,
      details: { currentVersion: 2 },
    })

    expect(mocks.query).toHaveBeenCalledTimes(1)
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('select hotel.version')
    expect(sql).toContain('from hotels hotel')
    expect(sql).toContain('hotel.tenant_id = $1')
    expect(sql).toContain('hotel.id = $2')
    expect(sql).toContain('hotel.deleted_at is null')
    expect(sql).toContain('for update of hotel')
    expect(sql).not.toMatch(/\bover\s*\(/i)
    expect(values).toEqual(['tenant-a', 'hotel-jw-rio'])
  })
})

function principal(): RequestPrincipal {
  return {
    tenantId: 'tenant-a',
    user: { id: 'user-a' },
  } as RequestPrincipal
}
