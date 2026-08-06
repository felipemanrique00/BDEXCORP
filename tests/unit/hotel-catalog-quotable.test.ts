import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { hotelCatalogQuerySchema } from '@/lib/hotel-catalog/schema'
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

import { listHotelCatalog } from '@/lib/server/hotel-catalog-service'

const quoteFormSource = readFileSync(
  resolve(process.cwd(), 'components/travel/offline-hotel-quote-form.tsx'),
  'utf8',
)
const offlineQuoteServiceSource = readFileSync(
  resolve(process.cwd(), 'lib/server/offline-quote-service.ts'),
  'utf8',
)

const CITY_ID = '1eeb0328-cc46-46f1-bfaa-d31c0ca51921'

describe('quotable hotel catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.query.mockResolvedValue({ rows: [] })
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, callback: (client: { query: typeof mocks.query }) => unknown) => (
        callback({ query: mocks.query })
      ),
    )
  })

  it('parses the explicit quotable query flag without changing the generic catalog default', () => {
    expect(hotelCatalogQuerySchema.parse({}).quotable).toBe(false)
    expect(hotelCatalogQuerySchema.parse({ quotable: 'true' }).quotable).toBe(true)
    expect(hotelCatalogQuerySchema.parse({ quotable: 'false' }).quotable).toBe(false)
    expect(hotelCatalogQuerySchema.safeParse({ quotable: 'not-a-boolean' }).success).toBe(false)
  })

  it('requires active hotel, supplier link and room type for quotation queries', async () => {
    await listHotelCatalog(principal(), {
      cityId: CITY_ID,
      status: 'active',
      quotable: 'true',
      limit: '25',
    })

    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain("hotel.status = 'active'")
    expect(sql).toContain('from hotel_suppliers quote_link')
    expect(sql).toContain('quote_link.hotel_id = hotel.id')
    expect(sql).toContain('quote_link.is_active')
    expect(sql).toContain('quote_link.ended_at is null')
    expect(sql).toContain("quote_supplier.status = 'active'")
    expect(sql).toContain('quote_supplier.deleted_at is null')
    expect(sql).toContain("quote_supplier.service_types @> array['hotel']::text[]")
    expect(sql).toContain('from hotel_room_types quotable_room')
    expect(sql).toContain('quotable_room.hotel_id = hotel.id')
    expect(sql).toContain('quotable_room.is_active')
    expect(sql).toContain('quotable_room.deleted_at is null')
    expect(values).toEqual(['tenant-a', CITY_ID, 'active', 25, 0])
  })

  it('does not apply quotation eligibility to the generic hotel catalog', async () => {
    await listHotelCatalog(principal(), { cityId: CITY_ID })

    const [sql] = mocks.query.mock.calls[0] as [string]
    expect(sql).not.toContain('quote_link')
    expect(sql).not.toContain('quote_supplier')
    expect(sql).not.toContain('quotable_room')
  })

  it('requests only quotable hotels for the exact demand city and explains the scope in the UI', () => {
    expect(quoteFormSource).toContain("quotable: 'true'")
    expect(quoteFormSource).toContain('hotel.cityId === cityId')
    expect(quoteFormSource).toContain('Catálogo consultado:')
    expect(quoteFormSource).toContain('hotelLocationLabel(item)')
    expect(quoteFormSource).toContain('Nenhum hotel elegível para cotação')
  })

  it('revalidates the hotel supplier service type when the quote is published', () => {
    expect(offlineQuoteServiceSource)
      .toContain("supplier.service_types @> array['hotel']::text[]")
  })
})

function principal(): RequestPrincipal {
  return {
    tenantId: 'tenant-a',
    user: { id: 'user-a' },
  } as RequestPrincipal
}
