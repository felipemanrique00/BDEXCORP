import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0069_offline_air_workflow.sql'),
  'utf8',
)

describe('offline air workflow migration', () => {
  it('separates demand, quote, reservation and emission service details', () => {
    for (const table of [
      'air_demand_details',
      'air_demand_legs',
      'air_quote_option_details',
      'air_quote_segments',
      'air_reservation_details',
      'air_reservation_segments',
      'air_emission_tickets',
    ]) {
      expect(migration).toMatch(new RegExp(`create table if not exists ${table}`, 'i'))
    }
  })

  it('keeps monetary totals exact in minor units', () => {
    expect(migration).toMatch(
      /total_amount_minor = fare_amount_minor \+ tax_amount_minor \+ rav_amount_minor \+ rac_amount_minor/i,
    )
    expect(migration).toMatch(
      /air_emission_tickets[\s\S]*total_amount_minor = fare_amount_minor \+ tax_amount_minor/i,
    )
  })

  it('isolates every air table by tenant under forced RLS', () => {
    expect(migration).toMatch(/alter table %I enable row level security/i)
    expect(migration).toMatch(/alter table %I force row level security/i)
    expect(migration).toMatch(/create policy tenant_isolation on %I/i)
    expect(migration).toMatch(/'air_emission_tickets'/i)
  })

  it('validates emission, reservation and passenger scope', () => {
    expect(migration).toMatch(/create or replace function validate_air_emission_ticket_scope\(\)/i)
    expect(migration).toMatch(/emission_reservation <> new\.reservation_id/i)
    expect(migration).toMatch(/traveler_demand <> emission_demand/i)
  })

  it('is additive and contains no destructive table operation', () => {
    expect(migration).not.toMatch(/\b(?:drop\s+table|drop\s+column|truncate\s+table)\b/i)
  })
})
