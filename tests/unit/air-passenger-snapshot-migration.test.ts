import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0071_air_demand_passenger_snapshots.sql'),
  'utf8',
)

describe('air passenger snapshot migration', () => {
  it('adds explicit PNR identity snapshots without making legacy travelers invalid', () => {
    expect(migration).toContain('first_name_snapshot text')
    expect(migration).toContain('last_name_snapshot text')
    expect(migration).toContain('document_number_snapshot text')
    expect(migration).toContain('birth_date_snapshot date')
    expect(migration).toContain('traveler_sequence smallint')
    expect(migration).not.toMatch(/alter column[^;]+set not null/i)
    expect(migration).toContain('not valid')
    expect(migration).toContain('validate constraint demand_travelers_sequence_positive')
  })

  it('indexes active travelers by demand', () => {
    expect(migration).toContain('demand_travelers_demand_active_idx')
    expect(migration).toContain('demand_travelers_active_sequence_uidx')
    expect(migration).toContain('(tenant_id, demand_id, traveler_sequence)')
    expect(migration).toContain('where deleted_at is null')
  })
})
