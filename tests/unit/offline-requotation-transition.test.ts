import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0063_repair_offline_requotation_transition.sql'),
  'utf8',
)
const machine = readFileSync(
  resolve(process.cwd(), 'lib/travel-lifecycle/machine.ts'),
  'utf8',
)

describe('offline requotation lifecycle alignment', () => {
  it('allows a new quotation round after a requester-facing round', () => {
    expect(machine).toContain("start_quotation: { from: ['approved_for_quotation', 'pending_choice', 'failed']")
    expect(migration).toContain("'pending_choice>quoting'")
    expect(migration).toContain("'quoting>pending_choice'")
  })

  it('keeps command, idempotency and version guards in the database trigger', () => {
    expect(migration).toContain("current_setting('app.lifecycle_command', true)")
    expect(migration).toContain("current_setting('app.idempotency_key', true)")
    expect(migration).toContain('new.lifecycle_version <> old.lifecycle_version + 1')
    expect(migration).toContain('create or replace function enforce_demand_lifecycle_transition()')
  })
})
