import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0066_voucher_presentation_settings.sql'),
  'utf8',
)
const voucherService = readFileSync(
  resolve(process.cwd(), 'lib/server/voucher-service.ts'),
  'utf8',
)
const apiRoute = readFileSync(
  resolve(
    process.cwd(),
    'app/api/voucher-presentation-settings/[scopeType]/[scopeId]/route.ts',
  ),
  'utf8',
)

describe('voucher presentation settings migration', () => {
  it('creates one tri-state relational configuration for group or company', () => {
    expect(migration).toMatch(/create table if not exists voucher_presentation_settings/i)
    expect(migration).toMatch(/scope_type text not null check \(scope_type in \('group', 'company'\)\)/i)
    expect(migration).toMatch(/show_confirmed_values boolean,/i)
    expect(migration).toMatch(/show_cancellation_terms boolean,/i)
    expect(migration).toMatch(/show_administrative_data boolean,/i)
    expect(migration).not.toMatch(/show_(?:confirmed_values|cancellation_terms|administrative_data) boolean not null/i)
    expect(migration).toMatch(/scope_type = 'group'[\s\S]*business_group_id is not null[\s\S]*company_id is null/i)
    expect(migration).toMatch(/scope_type = 'company'[\s\S]*company_id is not null[\s\S]*business_group_id is null/i)
  })

  it('uses composite tenant foreign keys, unique targets and forced RLS', () => {
    expect(migration).toMatch(/foreign key \(tenant_id, business_group_id\)[\s\S]*references business_groups\(tenant_id, id\)/i)
    expect(migration).toMatch(/foreign key \(tenant_id, company_id\)[\s\S]*references companies\(tenant_id, id\)/i)
    expect(migration).toMatch(/unique index[^;]+\(tenant_id, business_group_id\)[\s\S]*where scope_type = 'group'/i)
    expect(migration).toMatch(/unique index[^;]+\(tenant_id, company_id\)[\s\S]*where scope_type = 'company'/i)
    expect(migration).toMatch(/alter table voucher_presentation_settings force row level security/i)
    expect(migration).toMatch(/tenant_id = nullif\(current_setting\('app\.tenant_id'/i)
  })

  it('records structural authorship and prevents target mutation', () => {
    expect(migration).toMatch(/version bigint not null default 1 check \(version > 0\)/i)
    expect(migration).toMatch(/created_by uuid references users\(id\)/i)
    expect(migration).toMatch(/updated_by uuid references users\(id\)/i)
    expect(migration).toMatch(/created_at timestamptz not null default now\(\)/i)
    expect(migration).toMatch(/updated_at timestamptz not null default now\(\)/i)
    expect(migration).toMatch(/tenant e o escopo da configuracao de voucher sao imutaveis/i)
  })

  it('exposes guarded GET/PATCH and attaches effective settings in voucher service paths', () => {
    expect(apiRoute).toContain("permission: 'ver_vouchers'")
    expect(apiRoute).toContain("permission: 'alterar_configuracoes'")
    expect(apiRoute).toContain('export async function GET')
    expect(apiRoute).toContain('export async function PATCH')
    expect(voucherService.match(/attachVoucherPresentationSettings/g)?.length).toBeGreaterThanOrEqual(6)
  })
})
