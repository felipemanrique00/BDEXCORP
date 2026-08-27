import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  busDemandDetailsSchema,
  busQuoteOptionDetailsSchema,
  carDemandDetailsSchema,
  carQuoteOptionDetailsSchema,
  catalogEntryNeedsReview,
  offlineCatalogProvenanceSchema,
} from '@/lib/offline-ground/schema'

const migration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0078_company_portal_ground_offline_catalog.sql'),
  'utf8',
)

const UUIDS = {
  supplier: '00000000-0000-4000-8000-000000000001',
  pickup: '00000000-0000-4000-8000-000000000002',
  returned: '00000000-0000-4000-8000-000000000003',
  origin: '00000000-0000-4000-8000-000000000004',
  destination: '00000000-0000-4000-8000-000000000005',
  reviewer: '00000000-0000-4000-8000-000000000006',
  route: '00000000-0000-4000-8000-000000000007',
  thirdCity: '00000000-0000-4000-8000-000000000008',
  originTerminal: '00000000-0000-4000-8000-000000000009',
  destinationTerminal: '00000000-0000-4000-8000-000000000010',
  thirdTerminal: '00000000-0000-4000-8000-000000000011',
}

describe('offline ground catalog foundation', () => {
  it('creates tenant-isolated catalogs and service-specific demand/quote snapshots', () => {
    for (const table of [
      'offline_catalog_sources',
      'rental_locations',
      'bus_terminals',
      'bus_routes',
      'car_demand_details',
      'bus_demand_details',
      'bus_demand_legs',
      'car_quote_option_details',
      'bus_quote_option_details',
      'bus_quote_segments',
    ]) {
      expect(migration).toContain(`create table if not exists ${table}`)
      expect(migration).toContain(`alter table %I enable row level security`)
    }
    expect(migration).toContain("supplier.service_types @> array[expected_service]::text[]")
    expect(migration).toContain('validate_ground_terminal_city_scope')
    expect(migration).toContain('validate_ground_demand_service_scope')
    expect(migration).toContain('validate_ground_quote_option_scope')
  })

  it('keeps verified provenance auditable', () => {
    expect(offlineCatalogProvenanceSchema.safeParse({
      reviewStatus: 'verified',
      sourceUrl: 'https://example.test/catalog',
    }).success).toBe(false)

    expect(offlineCatalogProvenanceSchema.safeParse({
      reviewStatus: 'verified',
      sourceUrl: 'https://example.test/catalog',
      reviewedAt: '2026-08-17T12:00:00-03:00',
      reviewedBy: UUIDS.reviewer,
    }).success).toBe(true)
  })

  it('requires coherent car periods, locations and exact quote totals', () => {
    expect(carDemandDetailsSchema.safeParse({
      pickupAt: '2026-09-01T10:00:00-03:00',
      returnAt: '2026-09-03T10:00:00-03:00',
    }).success).toBe(false)

    expect(carDemandDetailsSchema.safeParse({
      pickupLocationText: 'Loja a confirmar',
      returnLocationText: 'Loja a confirmar',
      pickupAt: '2026-09-03T10:00:00-03:00',
      returnAt: '2026-09-01T10:00:00-03:00',
    }).success).toBe(false)

    const base = {
      supplierId: UUIDS.supplier,
      pickupLocationId: UUIDS.pickup,
      returnLocationId: UUIDS.returned,
      categoryName: 'Economico',
      rentalDays: 2,
      dailyAmountMinor: 10_000,
      protectionAmountMinor: 2_000,
      feeAmountMinor: 500,
      taxAmountMinor: 250,
    }
    expect(carQuoteOptionDetailsSchema.safeParse({
      ...base,
      totalAmountMinor: 22_750,
    }).success).toBe(true)
    expect(carQuoteOptionDetailsSchema.safeParse({
      ...base,
      totalAmountMinor: 22_749,
    }).success).toBe(false)
  })

  it('supports one-way, round-trip and multi-city bus demands', () => {
    const leg = {
      originCityId: UUIDS.origin,
      destinationCityId: UUIDS.destination,
      departureDate: '2026-09-01',
      earliestDeparture: '08:00',
      latestDeparture: '12:00',
    }

    expect(busDemandDetailsSchema.safeParse({
      tripType: 'one_way',
      legs: [leg],
    }).success).toBe(true)
    expect(busDemandDetailsSchema.safeParse({
      tripType: 'round_trip',
      legs: [leg],
    }).success).toBe(false)

    const outbound = {
      ...leg,
      originTerminalId: UUIDS.originTerminal,
      destinationTerminalId: UUIDS.destinationTerminal,
    }
    const returning = {
      ...leg,
      originCityId: UUIDS.destination,
      destinationCityId: UUIDS.origin,
      originTerminalId: UUIDS.destinationTerminal,
      destinationTerminalId: UUIDS.originTerminal,
      departureDate: '2026-09-05',
    }
    expect(busDemandDetailsSchema.safeParse({
      tripType: 'round_trip',
      legs: [outbound, returning],
    }).success).toBe(true)
    expect(busDemandDetailsSchema.safeParse({
      tripType: 'round_trip',
      legs: [outbound, { ...returning, originCityId: UUIDS.thirdCity }],
    }).success).toBe(false)
    expect(busDemandDetailsSchema.safeParse({
      tripType: 'round_trip',
      legs: [outbound, { ...returning, departureDate: '2026-08-31' }],
    }).success).toBe(false)

    const continuation = {
      ...leg,
      originCityId: UUIDS.destination,
      destinationCityId: UUIDS.thirdCity,
      originTerminalId: UUIDS.destinationTerminal,
      destinationTerminalId: UUIDS.thirdTerminal,
      departureDate: '2026-09-03',
    }
    expect(busDemandDetailsSchema.safeParse({
      tripType: 'multi_city',
      legs: [outbound, continuation],
    }).success).toBe(true)
    expect(busDemandDetailsSchema.safeParse({
      tripType: 'multi_city',
      legs: [outbound, { ...continuation, originCityId: UUIDS.origin }],
    }).success).toBe(false)
  })

  it('requires coherent bus option totals and segment times', () => {
    const result = busQuoteOptionDetailsSchema.safeParse({
      supplierId: UUIDS.supplier,
      className: 'Convencional',
      fareAmountMinor: 15_000,
      taxAmountMinor: 1_500,
      feeAmountMinor: 500,
      totalAmountMinor: 17_000,
      segments: [{
        routeId: UUIDS.route,
        originCityId: UUIDS.origin,
        destinationCityId: UUIDS.destination,
        departsAt: '2026-09-01T08:00:00-03:00',
        arrivesAt: '2026-09-01T18:00:00-03:00',
        className: 'Convencional',
      }],
    })
    expect(result.success).toBe(true)
  })

  it('marks pending and expired records for review', () => {
    expect(catalogEntryNeedsReview({ reviewStatus: 'pending' })).toBe(true)
    expect(catalogEntryNeedsReview({
      reviewStatus: 'verified',
      sourceObservedAt: '2026-01-01T00:00:00Z',
      reviewIntervalDays: 30,
    }, new Date('2026-08-17T00:00:00Z'))).toBe(true)
    expect(catalogEntryNeedsReview({
      reviewStatus: 'verified',
      sourceObservedAt: '2026-08-01T00:00:00Z',
      reviewIntervalDays: 30,
    }, new Date('2026-08-17T00:00:00Z'))).toBe(false)
  })
})
