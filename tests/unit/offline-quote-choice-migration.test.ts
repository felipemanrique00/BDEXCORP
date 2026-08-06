import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0061_offline_quote_choice_integrity.sql'),
  'utf8',
)

describe('offline quote choice integrity migration', () => {
  it('backfills a bounded, tenant-scoped idempotency key before making it mandatory', () => {
    expect(migration).toMatch(/add column if not exists idempotency_key text/i)
    expect(migration).toMatch(
      /set idempotency_key = 'legacy-selection:' \|\| id::text[\s\S]*where idempotency_key is null/i,
    )
    expect(migration).toMatch(
      /check \(char_length\(idempotency_key\) between 8 and 200\) not valid/i,
    )
    expect(migration).toMatch(/validate constraint travel_quote_selections_idempotency_key_length_check/i)
    expect(migration).toMatch(/alter column idempotency_key set not null/i)
    expect(migration).toMatch(
      /constraint travel_quote_selections_tenant_idempotency_key[\s\S]*unique \(tenant_id, idempotency_key\)/i,
    )
  })

  it('adds the unique parent keys required by tenant-safe composite foreign keys', () => {
    expect(migration).toMatch(
      /constraint travel_quotes_tenant_demand_id_key[\s\S]*unique \(tenant_id, demand_id, id\)/i,
    )
    expect(migration).toMatch(
      /constraint travel_quote_options_tenant_quote_id_key[\s\S]*unique \(tenant_id, quote_id, id\)/i,
    )
  })

  it('proves that a selected quote belongs to the demand and the option belongs to the quote', () => {
    expect(migration).toMatch(
      /constraint travel_quote_selections_demand_quote_scope_fk[\s\S]*foreign key \(tenant_id, demand_id, quote_id\)[\s\S]*references travel_quotes \(tenant_id, demand_id, id\)[\s\S]*not valid/i,
    )
    expect(migration).toMatch(
      /constraint travel_quote_selections_quote_option_scope_fk[\s\S]*foreign key \(tenant_id, quote_id, option_id\)[\s\S]*references travel_quote_options \(tenant_id, quote_id, id\)[\s\S]*not valid/i,
    )
    expect(migration).toMatch(/validate constraint travel_quote_selections_demand_quote_scope_fk/i)
    expect(migration).toMatch(/validate constraint travel_quote_selections_quote_option_scope_fk/i)
  })

  it('indexes manual quote lists and selection lookups', () => {
    expect(migration).toMatch(
      /create index if not exists travel_quotes_manual_demand_status_idx[\s\S]*\(tenant_id, demand_id, status, created_at desc\)[\s\S]*where provider = 'manual-offline'/i,
    )
    expect(migration).toMatch(
      /create index if not exists travel_quote_selections_quote_status_idx[\s\S]*\(tenant_id, quote_id, status, chosen_at desc\)/i,
    )
  })

  it('is rerunnable and preserves the existing tables, columns and foreign keys', () => {
    expect(migration.match(/if not exists \(/gi)?.length).toBeGreaterThanOrEqual(5)
    expect(migration).not.toMatch(/\b(?:drop\s+table|drop\s+column|drop\s+constraint|truncate\s+table)\b/i)
  })
})
