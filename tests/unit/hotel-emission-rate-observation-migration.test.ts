import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0080_hotel_emission_rate_observations.sql'),
  'utf8',
)
const issueService = readFileSync(
  resolve(process.cwd(), 'lib/server/offline-travel-service.ts'),
  'utf8',
)

describe('hotel emission rate observations', () => {
  it('stores an additive immutable tenant-scoped observation without mutating the contractual catalog', () => {
    expect(migration).toMatch(/create table if not exists hotel_emission_rate_observations/i)
    expect(migration).toMatch(/before update or delete on hotel_emission_rate_observations/i)
    expect(migration).toMatch(/observacoes de tarifa emitida sao imutaveis/i)
    expect(migration).toMatch(/option_service_fee_amount/i)
    expect(migration).toMatch(/nao somar por quarto nem reaplicar automaticamente/i)
    expect(migration).toMatch(/force row level security/i)
    expect(migration).toMatch(/tenant_id = nullif\(current_setting\('app\.tenant_id'/i)
    expect(migration).not.toMatch(/update hotel_supplier_rates/i)
    expect(migration).not.toMatch(/\b(?:drop\s+table|drop\s+column|truncate\s+table)\b/i)
  })

  it('binds each observation to the issued hotel reservation and approved quote option', () => {
    expect(migration).toMatch(/emission_status not in \('issued', 'partially_issued'\)/i)
    expect(migration).toMatch(/emission_provider <> 'manual-offline'/i)
    expect(migration).toMatch(/reservation_service <> 'hotelaria'/i)
    expect(migration).toMatch(/reservation_quote_id is distinct from new\.quote_id/i)
    expect(migration).toMatch(/hotel_quote_option_details detail/i)
    expect(migration).toMatch(/hotel_demand_rooms room/i)
  })

  it('records the observation in the same issuance transaction and marks supplier divergence', () => {
    expect(issueService).toContain('persistHotelEmissionRateObservations')
    expect(issueService).toContain('hotel_emission_rate_observations')
    expect(issueService).toContain('supplier_matches_quote')
    expect(issueService).toMatch(/!suppliersDiffer\(row\.quoted_supplier_name, operationalSupplierName\)/i)
  })
})
