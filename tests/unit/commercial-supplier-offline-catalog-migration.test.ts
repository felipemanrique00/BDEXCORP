import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  path.resolve(
    process.cwd(),
    'deploy/postgres/migrations/0068_commercial_supplier_offline_catalog.sql',
  ),
  'utf8',
)

describe('commercial supplier offline catalog migration', () => {
  it('evolui os cadastros existentes sem recriar suas tabelas', () => {
    expect(migration).toContain('alter table commercial_suppliers')
    expect(migration).toContain("reservation_system text not null default 'manual'")
    expect(migration).toContain("'manual', 'email', 'portal', 'api', 'other'")
    expect(migration).toContain('alter table commercial_supplier_contacts')
    expect(migration).toContain('add column if not exists fax text')
    expect(migration).toContain('commercial_supplier_contacts_channel_check')
    expect(migration).toContain('email is not null or phone is not null or fax is not null')
    expect(migration).toContain('add column if not exists chain_name text')
    expect(migration).toContain('add column if not exists brand_name text')
    expect(migration).toContain('star_rating between 1 and 5')
    expect(migration).toContain("out_of_period_policy text not null default 'block'")
  })

  it('acrescenta composicao e governanca da tarifa', () => {
    for (const fragment of [
      'rack_amount numeric(14,2)',
      'service_fee_amount numeric(14,2)',
      'is_net boolean not null default false',
      'is_suspended boolean not null default false',
      "scope_type text not null default 'global'",
    ]) {
      expect(migration).toContain(fragment)
    }
    expect(migration).toContain("scope_type in ('global', 'restricted')")
  })

  it('isola escopos explicitos de empresa ou grupo por tenant', () => {
    expect(migration).toContain('create table if not exists hotel_supplier_rate_scopes')
    expect(migration).toContain('references hotel_supplier_rates(tenant_id, id) on delete cascade')
    expect(migration).toContain('references companies(tenant_id, id) on delete restrict')
    expect(migration).toContain('references business_groups(tenant_id, id) on delete restrict')
    expect(migration).toContain("scope_type text not null check (scope_type in ('company', 'group'))")
    expect(migration).toContain("(scope_type = 'company' and company_id is not null and business_group_id is null)")
    expect(migration).toContain("(scope_type = 'group' and company_id is null and business_group_id is not null)")
    expect(migration).toContain('hotel_supplier_rate_scopes_company_uidx')
    expect(migration).toContain('hotel_supplier_rate_scopes_group_uidx')
    expect(migration).toContain('alter table hotel_supplier_rate_scopes enable row level security')
    expect(migration).toContain('alter table hotel_supplier_rate_scopes force row level security')
    expect(migration).toContain('hotel_supplier_rate_scopes_set_updated_at')
    expect(migration).toContain('hotel_supplier_rate_scopes_validate_identity')
    expect(migration).toContain('validate_hotel_supplier_rate_scope_consistency')
    expect(migration).toContain('deferrable initially deferred')
  })
})
