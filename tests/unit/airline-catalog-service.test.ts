import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '@/lib/server/request-context'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTenantTransaction: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

import { listAirlines } from '@/lib/server/airline-catalog-service'

describe('airline catalog service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, callback: (client: { query: typeof mocks.query }) => unknown) => (
        callback({ query: mocks.query })
      ),
    )
  })

  it('searches a historical IATA alias and maps brand data', async () => {
    mocks.query.mockResolvedValue({
      rows: [{
        id: 'airline-latam',
        iata_code: 'LA',
        icao_code: 'LAN',
        name: 'LATAM',
        legal_name: 'LATAM Airlines Group S.A.',
        country_code: 'CL',
        logo_path: '/airlines/LA.svg',
        logo_background_color: '#1B0088',
        aliases: ['LATAM Brasil', 'JJ'],
        is_active: true,
        total_count: '1',
      }],
    })

    await expect(listAirlines(principal(), { q: 'jj' })).resolves.toEqual({
      items: [{
        id: 'airline-latam',
        iataCode: 'LA',
        icaoCode: 'LAN',
        name: 'LATAM',
        legalName: 'LATAM Airlines Group S.A.',
        countryCode: 'CL',
        logoPath: '/airlines/LA.svg',
        logoBackgroundColor: '#1B0088',
        aliases: ['LATAM Brasil', 'JJ'],
        isActive: true,
      }],
      total: 1,
    })

    expect(mocks.withTenantTransaction).toHaveBeenCalledWith('tenant-airline', expect.any(Function))
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('from geo_airline_aliases alias')
    expect(values).toEqual(['JJ', 'jj', 'JJ%', '%jj%', 30, 0])
  })
})

function principal(): RequestPrincipal {
  return {
    tenantId: 'tenant-airline',
  } as RequestPrincipal
}
