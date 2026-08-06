import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0065_hotel_demand_preferred_hotels.sql'),
  'utf8',
)

describe('hotel demand preferred hotels migration', () => {
  it('stores ordered preferences with tenant-safe identities and a bounded quotation capacity', () => {
    expect(migration).toMatch(/create table if not exists hotel_demand_preferred_hotels/i)
    expect(migration).toMatch(/preference_order smallint not null check \(preference_order between 1 and 10\)/i)
    expect(migration).toMatch(/primary key \(tenant_id, demand_id, hotel_id\)/i)
    expect(migration).toMatch(/unique \(tenant_id, demand_id, preference_order\)/i)
  })

  it('binds each preference to the normalized demand and hotel within the same tenant', () => {
    expect(migration).toMatch(
      /foreign key \(tenant_id, demand_id\)[\s\S]*references hotel_demand_details\(tenant_id, demand_id\) on delete cascade/i,
    )
    expect(migration).toMatch(
      /foreign key \(tenant_id, hotel_id\)[\s\S]*references hotels\(tenant_id, id\) on delete restrict/i,
    )
  })

  it('backfills the legacy singular preference as the first ordered item', () => {
    expect(migration).toMatch(
      /insert into hotel_demand_preferred_hotels[\s\S]*select tenant_id, demand_id, preferred_hotel_id, 1, created_by, created_at[\s\S]*from hotel_demand_details[\s\S]*where preferred_hotel_id is not null[\s\S]*on conflict do nothing/i,
    )
    expect(migration).not.toMatch(/drop\s+column\s+(?:if\s+exists\s+)?preferred_hotel_id/i)
  })

  it('enforces tenant isolation and remains safe to rerun', () => {
    expect(migration).toMatch(/alter table hotel_demand_preferred_hotels enable row level security/i)
    expect(migration).toMatch(/alter table hotel_demand_preferred_hotels force row level security/i)
    expect(migration).toMatch(/create policy tenant_isolation on hotel_demand_preferred_hotels/i)
    expect(migration).toContain("current_setting('app.tenant_id', true)")
    expect(migration).toMatch(/create index if not exists hotel_demand_preferred_hotels_hotel_idx/i)
    expect(migration).not.toMatch(/\b(?:drop\s+table|truncate\s+table)\b/i)
  })
})
