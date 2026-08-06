import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0054_offline_travel_flow.sql'),
  'utf8',
)
const budgetLookupMigration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0057_offline_budget_commitment_lookup.sql'),
  'utf8',
)
const offlineWorkflowMigration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0060_hotel_demand_offline_workflow.sql'),
  'utf8',
)
const serverEnvironment = readFileSync(
  resolve(process.cwd(), 'lib/server/environment.ts'),
  'utf8',
)

describe('offline travel migration', () => {
  it('links each voucher to its relational emission with a tenant-safe foreign key', () => {
    expect(migration).toMatch(/alter table vouchers[\s\S]*add column if not exists emission_id uuid/i)
    expect(migration).toMatch(/constraint vouchers_emission_fk[\s\S]*foreign key \(tenant_id, emission_id\)[\s\S]*references travel_emissions\(tenant_id, id\) on delete restrict/i)
  })

  it('prevents duplicate active vouchers and indexes both offline operation stages', () => {
    expect(migration).toMatch(/create unique index if not exists vouchers_emission_uidx[\s\S]*on vouchers \(tenant_id, emission_id\)[\s\S]*where emission_id is not null and deleted_at is null/i)
    expect(migration).toMatch(/create index if not exists reservations_manual_offline_idx[\s\S]*where provider = 'manual-offline'/i)
    expect(migration).toMatch(/create index if not exists travel_emissions_manual_offline_idx[\s\S]*where provider = 'manual-offline'/i)
  })

  it('validates emission, reservation, demand and company scope through a trigger', () => {
    expect(migration).toMatch(/create or replace function validate_voucher_emission_scope\(\)/i)
    expect(migration).toMatch(/emission_company <> new\.company_id/i)
    expect(migration).toMatch(/emission_demand is distinct from new\.demand_id/i)
    expect(migration).toMatch(/emission_reservation is distinct from new\.reservation_id/i)
    expect(migration).toMatch(/create trigger vouchers_validate_emission_scope[\s\S]*before insert or update[\s\S]*execute function validate_voucher_emission_scope\(\)/i)
  })

  it('opens segment types to the validated extensible catalog without removing RLS', () => {
    expect(migration).toMatch(/add constraint travel_segments_segment_type_check[\s\S]*segment_type ~ '\^\[a-z\]\[a-z0-9_\]\{1,39\}\$'/i)
    expect(migration).not.toMatch(/disable row level security/i)
    expect(migration).not.toMatch(/\b(?:drop\s+table|drop\s+column|truncate\s+table)\b/i)
  })

  it('indexes reservation budget commitments used by offline issuance', () => {
    expect(budgetLookupMigration).toMatch(
      /create index if not exists budget_commitments_reservation_status_idx[\s\S]*on budget_commitments \(tenant_id, reservation_id, status\)[\s\S]*where reservation_id is not null/i,
    )
  })

  it('stores immutable reservation correction snapshots under tenant RLS', () => {
    expect(offlineWorkflowMigration).toMatch(/create table if not exists offline_reservation_revisions/i)
    expect(offlineWorkflowMigration).toMatch(/previous_snapshot jsonb not null/i)
    expect(offlineWorkflowMigration).toMatch(/next_snapshot jsonb not null/i)
    expect(offlineWorkflowMigration).toMatch(/unique \(tenant_id, reservation_id, to_version\)/i)
    expect(offlineWorkflowMigration).toMatch(/'offline_reservation_revisions'/i)
  })

  it('keeps the server feature disabled unless the environment explicitly enables it', () => {
    expect(serverEnvironment).toMatch(/OFFLINE_TRAVEL_ENABLED:\s*optionalBooleanValue\.default\(false\)/)
  })
})
