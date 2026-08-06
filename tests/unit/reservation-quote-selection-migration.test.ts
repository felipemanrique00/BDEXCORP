import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0062_reservation_quote_selection_integrity.sql'),
  'utf8',
)

describe('reservation quote selection integrity migration', () => {
  it('links a reservation to the exact demand, quote, option and formal selection', () => {
    expect(migration).toContain('add column if not exists quote_selection_id uuid')
    expect(migration).toContain('travel_quote_selections_fulfillment_scope_key')
    expect(migration).toContain('reservations_quote_selection_scope_fk')
    expect(migration).toMatch(/tenant_id,\s+demand_id,\s+selected_quote_id,\s+selected_quote_option_id,\s+quote_selection_id/)
    expect(migration).toMatch(/tenant_id,\s+demand_id,\s+quote_id,\s+option_id,\s+id/)
  })

  it('keeps legacy reservations compatible and prevents duplicate fulfillment', () => {
    expect(migration).toContain('quote_selection_id is null')
    expect(migration).toContain('reservations_quote_selection_uidx')
    expect(migration).toContain('where quote_selection_id is not null')
  })
})
