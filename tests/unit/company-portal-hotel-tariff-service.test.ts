import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HotelRateSelectionCandidate } from '@/lib/server/hotel-rate-suggestion-service'
import type { RequestPrincipal } from '@/lib/server/request-context'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTenantTransaction: vi.fn(),
  requireCompanyAccessWithAnyPermission: vi.fn(),
  listHotelRateSelectionCandidates: vi.fn(),
}))

vi.mock('@/lib/server/database', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}))

vi.mock('@/lib/server/corporate-access-service', () => ({
  requireCompanyAccessWithAnyPermission: mocks.requireCompanyAccessWithAnyPermission,
  CorporateAccessDeniedError: class CorporateAccessDeniedError extends Error {
    code: string

    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
}))

vi.mock('@/lib/server/hotel-rate-suggestion-service', () => ({
  listHotelRateSelectionCandidates: mocks.listHotelRateSelectionCandidates,
}))

import {
  attachCompanyPortalHotelTariffReference,
  listCompanyPortalHotelTariffs,
} from '@/lib/server/company-portal-hotel-tariff-service'

describe('company portal hotel tariff service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireCompanyAccessWithAnyPermission.mockResolvedValue(undefined)
    mocks.withTenantTransaction.mockImplementation(
      async (_tenantId: string, operation: (client: { query: typeof mocks.query }) => unknown) => (
        operation({ query: mocks.query })
      ),
    )
  })

  it('lists only active quotable catalog presentation when rate context is absent', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 'company-a', group_id: 'group-a' }] })
      .mockResolvedValueOnce({ rows: [{
        hotel_id: 'hotel-a',
        name: 'Hotel Centro',
        category: 'Executivo',
        star_rating: '4',
        address: 'Rua Segura, 10',
        city: 'Sao Paulo',
        billing_info: 'never-projected',
      }] })

    const result = await listCompanyPortalHotelTariffs(principal(), {
      companyId: 'company-a',
      cityId: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
      q: 'Centro',
      limit: '20',
    })

    expect(mocks.requireCompanyAccessWithAnyPermission).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      'company-a',
      ['ver_demandas', 'criar_demandas'],
    )
    expect(mocks.listHotelRateSelectionCandidates).not.toHaveBeenCalled()
    expect(result).toEqual({
      companyId: 'company-a',
      cityId: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
      checkIn: null,
      checkOut: null,
      occupancyType: null,
      roomCount: 1,
      items: [{
        hotelId: 'hotel-a',
        name: 'Hotel Centro',
        category: 'Executivo',
        starRating: 4,
        address: 'Rua Segura, 10',
        city: 'Sao Paulo',
        amenities: [],
        images: [],
        priceStatus: 'not_available',
        tariff: null,
      }],
    })
    const [catalogSql, catalogValues] = mocks.query.mock.calls[1] as [string, unknown[]]
    expect(catalogSql).toContain("hotel.status = 'active'")
    expect(catalogSql).toContain('from hotel_suppliers quotable_link')
    expect(catalogSql).toContain('from hotel_room_types quotable_room')
    expect(catalogSql).not.toContain('billing_info')
    expect(catalogSql).not.toContain('reservation_email')
    expect(catalogValues).toEqual([
      'tenant-a',
      'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
      null,
      'centro',
      20,
      null,
    ])
    expect(JSON.stringify(result)).not.toContain('never-projected')
  })

  it('rejects a company outside the currently selected corporate context', async () => {
    await expect(listCompanyPortalHotelTariffs(principal(), {
      scopeType: 'company',
      scopeId: 'company-a',
      companyId: 'company-b',
      cityId: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
    })).rejects.toMatchObject({ code: 'COMPANY_PORTAL_COMPANY_SCOPE_DENIED' })

    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('passes server-derived group context to the shared selector and suppresses a net amount', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 'company-a', group_id: 'group-a' }] })
      .mockResolvedValueOnce({ rows: [{
        hotel_id: 'hotel-a',
        name: 'Hotel Centro',
        category: null,
        star_rating: null,
        address: null,
        city: 'Sao Paulo',
      }] })
    mocks.listHotelRateSelectionCandidates.mockResolvedValue([
      candidate({ isNet: true, nightlyRate: 8_765.43 }),
    ])

    const result = await listCompanyPortalHotelTariffs(principal(), {
      companyId: 'company-a',
      cityId: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
      checkIn: '2026-10-10',
      checkOut: '2026-10-12',
      occupancyType: 'double',
      roomCount: 2,
    })

    expect(mocks.listHotelRateSelectionCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ query: mocks.query }),
      'tenant-a',
      {
        companyId: 'company-a',
        groupId: 'group-a',
        cityId: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
        checkIn: '2026-10-10',
        checkOut: '2026-10-12',
        occupancyType: 'double',
        roomCount: 2,
        hotelIds: ['hotel-a'],
      },
    )
    expect(result).toMatchObject({ roomCount: 2 })
    expect(result.items[0]).toMatchObject({ priceStatus: 'under_review', tariff: null })
    expect(JSON.stringify(result)).not.toContain('8765.43')
  })

  it('captures a server-owned public reference for the selected hotels', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 'company-a', group_id: 'group-a' }] })
      .mockResolvedValueOnce({ rows: [{
        hotel_id: 'hotel-a',
        name: 'Hotel Centro',
        category: 'Executivo',
        star_rating: '4',
        address: 'Rua Segura, 10',
        city: 'Sao Paulo',
      }] })
    mocks.listHotelRateSelectionCandidates.mockResolvedValue([candidate({
      nightlyRate: 200,
      nightlyTaxes: 20,
      serviceFee: 15,
    })])

    const details = await attachCompanyPortalHotelTariffReference(
      principal(),
      'company-a',
      {
        country_id: '00000000-0000-4000-8000-000000000001',
        subdivision_id: '00000000-0000-4000-8000-000000000002',
        city_id: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
        cidade: 'Sao Paulo',
        data_checkin: '2026-10-10',
        data_checkout: '2026-10-12',
        preferred_hotel_ids: ['hotel-a'],
        preferences: {
          hotelTariffReference: { supplierId: 'client-forged-secret' },
          andar_alto: true,
        },
        needs_review: false,
        rooms: [{
          client_id: 'room-1',
          occupancy_code: 'single',
          guests: [{
            slot_index: 1,
            role: 'responsible',
            employee_id: 'employee-1',
            name: 'Hospede Teste',
            is_external: false,
          }],
        }],
      },
    )

    const snapshot = details.preferences.hotelTariffReference as Record<string, unknown>
    expect(details.preferences.andar_alto).toBe(true)
    expect(snapshot).toMatchObject({
      cityId: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
      checkIn: '2026-10-10',
      checkOut: '2026-10-12',
      occupancyType: 'single',
      roomCount: 1,
      items: [{
        hotelId: 'hotel-a',
        name: 'Hotel Centro',
        priceStatus: 'available',
        tariff: { estimatedTotal: 455 },
      }],
    })
    expect(JSON.stringify(snapshot)).not.toContain('client-forged-secret')
    expect(JSON.stringify(snapshot)).not.toContain('supplier-secret')
  })

  it('rejects a preferred hotel that no longer belongs to the active destination and occupancy', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 'company-a', group_id: 'group-a' }] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(attachCompanyPortalHotelTariffReference(
      principal(),
      'company-a',
      {
        country_id: '00000000-0000-4000-8000-000000000001',
        subdivision_id: '00000000-0000-4000-8000-000000000002',
        city_id: 'b9b0fb4f-501e-4aa1-ad29-52e459f5aa86',
        cidade: 'Sao Paulo',
        data_checkin: '2026-10-10',
        data_checkout: '2026-10-12',
        preferred_hotel_ids: ['hotel-outside-context'],
        preferences: {},
        needs_review: false,
        rooms: [{
          client_id: 'room-1',
          occupancy_code: 'single',
          guests: [{
            slot_index: 1,
            role: 'responsible',
            employee_id: 'employee-1',
            name: 'Hospede Teste',
            is_external: false,
          }],
        }],
      },
    )).rejects.toMatchObject({
      code: 'COMPANY_PORTAL_HOTEL_PREFERENCE_INVALID',
      status: 422,
    })
  })
})

function principal(): RequestPrincipal {
  return {
    tenantId: 'tenant-a',
    roleKey: 'requester',
    platformAdmin: false,
    corporateAccess: {
      companies: [{
        companyId: 'company-a',
        permissions: { ver_demandas: true, criar_demandas: true },
      }, {
        companyId: 'company-b',
        permissions: { ver_demandas: true, criar_demandas: true },
      }],
      contexts: [{
        type: 'company',
        id: 'company-a',
        companyIds: ['company-a'],
        canViewConsolidated: false,
      }, {
        type: 'company',
        id: 'company-b',
        companyIds: ['company-b'],
        canViewConsolidated: false,
      }],
      defaultContext: { type: 'company', id: 'company-a' },
    },
    user: {
      id: 'requester-a',
      role_key: 'requester',
      corporate_profile: 'requester',
    },
  } as RequestPrincipal
}

function candidate(overrides: Partial<HotelRateSelectionCandidate>): HotelRateSelectionCandidate {
  return {
    hotelId: 'hotel-a',
    hotelSupplierId: 'hotel-supplier-secret',
    supplierId: 'supplier-secret',
    supplierName: 'Fornecedor secreto',
    supplierCode: 'SUP-SECRET',
    roomTypeId: 'room-secret',
    roomCategory: 'Duplo',
    source: 'catalog',
    rateId: 'rate-secret',
    rateVersion: 1,
    emissionObservationId: null,
    emissionId: null,
    observedAt: null,
    nightlyRate: 100,
    nightlyTaxes: 10,
    serviceFee: 5,
    currency: 'BRL',
    refundable: false,
    mealPlan: null,
    cancellationPolicy: null,
    paymentTerms: 'internal-secret',
    scope: 'company',
    scopeLabel: 'Acordo da empresa',
    outsideValidity: false,
    outOfPeriodPolicy: 'block',
    isNet: false,
    supplierPriority: 1,
    ...overrides,
  }
}
