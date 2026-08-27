import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const service = readFileSync(
  resolve(process.cwd(), 'lib/server/hotel-rate-suggestion-service.ts'),
  'utf8',
)
const route = readFileSync(
  resolve(process.cwd(), 'app/api/offline-travel/hotel-rate-suggestions/route.ts'),
  'utf8',
)
const quoteService = readFileSync(
  resolve(process.cwd(), 'lib/server/offline-quote-service.ts'),
  'utf8',
)

describe('hotel rate suggestion contract', () => {
  it('derives company and group from the demand instead of accepting them from the client', () => {
    expect(service).toMatch(/join companies company[\s\S]*company\.group_id/i)
    expect(service).toContain("requireCompanyAccess(principal, context.company_id, 'operar_cotacoes')")
    expect(route).toContain("permission: 'operar_cotacoes'")
    expect(route).not.toMatch(/companyId|groupId/)
  })

  it('applies company, group and global precedence with full-stay validity', () => {
    expect(service).toMatch(/then 3[\s\S]*then 2[\s\S]*else 1/i)
    expect(service).toMatch(/rate\.valid_from <= \$3::date/i)
    expect(service).toMatch(/rate\.valid_until >= \(\$4::date - 1\)/i)
    expect(service).toMatch(/rate\.is_active and not rate\.is_suspended/i)
    expect(service).toMatch(/rate\.currency = 'BRL'/i)
    expect(service).toMatch(/matching_scope\.deleted_at is null/i)
    expect(service).toMatch(/link\.out_of_period_policy in \('warn', 'allow'\)/i)
    expect(service).toMatch(/inside_validity desc/i)
  })

  it('does not apply one suggestion to mixed room occupancies', () => {
    expect(service).toMatch(/occupancyTypes\.length !== 1/)
    expect(service).toContain('A demanda possui ocupacoes diferentes')
  })

  it('uses the last valid company emission only as fallback to a current catalog rate', () => {
    expect(service).toMatch(/hotel_emission_rate_observations observation/i)
    expect(service).toMatch(/emission\.status in \('issued', 'partially_issued'\)/i)
    expect(service).toMatch(/observation\.company_id = \$3/i)
    expect(service).toMatch(/observation\.supplier_matches_quote/i)
    expect(service).toMatch(/observation\.issued_at >= now\(\) - interval '180 days'/i)
    expect(service).toMatch(/observation\.issued_at <= now\(\) \+ interval '1 day'/i)
    expect(service).toMatch(/extract\(month from observation\.stay_start\) = extract\(month from \$4::date\)/i)
    expect(service).toMatch(/0::numeric as service_fee_amount/i)
    expect(service).toMatch(/!catalogOffers\.has\(suggestionOfferKey\(suggestion\)\)/i)
    expect(service).toContain("source: 'last_emission'")
  })

  it('revalidates catalog provenance, occupancy, values and terms before publication', () => {
    expect(quoteService).toContain('OFFLINE_QUOTE_CATALOG_RATE_STALE')
    expect(quoteService).toContain('OFFLINE_QUOTE_CATALOG_RATE_OCCUPANCY_MISMATCH')
    expect(quoteService).toContain('OFFLINE_QUOTE_CATALOG_RATE_CHANGED')
    expect(quoteService).toContain('OFFLINE_QUOTE_CATALOG_TERMS_CHANGED')
    expect(quoteService).toMatch(/room\.occupancy_type/i)
    expect(quoteService).toMatch(/rate\.metadata\?\.paymentTerms/i)
    expect(quoteService).toMatch(/link\.out_of_period_policy in \('warn', 'allow'\)/i)
  })

  it('revalidates an emitted observation and persists its identifier in quote provenance', () => {
    expect(quoteService).toContain('OFFLINE_QUOTE_EMISSION_RATE_STALE')
    expect(quoteService).toContain('OFFLINE_QUOTE_EMISSION_RATE_OCCUPANCY_MISMATCH')
    expect(quoteService).toContain('OFFLINE_QUOTE_EMISSION_RATE_CHANGED')
    expect(quoteService).toMatch(/emissionObservationReference: option\.emissionObservationReference/i)
    expect(quoteService).toMatch(/observation\.issued_at >= now\(\) - interval '180 days'/i)
    expect(quoteService).toMatch(/extract\(month from observation\.stay_start\) = extract\(month from \$4::date\)/i)
    expect(quoteService).toMatch(/not exists \([\s\S]*from hotel_supplier_rates current_rate/i)
  })
})
