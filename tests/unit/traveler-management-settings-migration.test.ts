import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0074_traveler_management_settings.sql'),
  'utf8',
)
const apiRoute = readFileSync(
  resolve(
    process.cwd(),
    'app/api/traveler-management-settings/[scopeType]/[scopeId]/route.ts',
  ),
  'utf8',
)
const service = readFileSync(
  resolve(process.cwd(), 'lib/server/traveler-management-settings-service.ts'),
  'utf8',
)

describe('traveler management settings migration and API contract', () => {
  it('creates a tri-state relational configuration for group or company', () => {
    expect(migration).toMatch(/create table if not exists traveler_management_settings/i)
    expect(migration).toMatch(/scope_type text not null check \(scope_type in \('group', 'company'\)\)/i)
    expect(migration).toMatch(/allow_requester_traveler_management boolean,/i)
    expect(migration).not.toMatch(/allow_requester_traveler_management boolean not null/i)
    expect(migration).toMatch(/scope_type = 'group'[\s\S]*business_group_id is not null[\s\S]*company_id is null/i)
    expect(migration).toMatch(/scope_type = 'company'[\s\S]*company_id is not null[\s\S]*business_group_id is null/i)
  })

  it('uses composite tenant foreign keys, unique targets and forced RLS', () => {
    expect(migration).toMatch(/foreign key \(tenant_id, business_group_id\)[\s\S]*references business_groups\(tenant_id, id\)/i)
    expect(migration).toMatch(/foreign key \(tenant_id, company_id\)[\s\S]*references companies\(tenant_id, id\)/i)
    expect(migration).toMatch(/unique index[^;]+\(tenant_id, business_group_id\)[\s\S]*where scope_type = 'group'/i)
    expect(migration).toMatch(/unique index[^;]+\(tenant_id, company_id\)[\s\S]*where scope_type = 'company'/i)
    expect(migration).toMatch(/alter table traveler_management_settings force row level security/i)
    expect(migration).toMatch(/tenant_id = nullif\(current_setting\('app\.tenant_id'/i)
  })

  it('tracks versions and authors while keeping the target immutable', () => {
    expect(migration).toMatch(/version bigint not null default 1 check \(version > 0\)/i)
    expect(migration).toMatch(/created_by uuid references users\(id\)/i)
    expect(migration).toMatch(/updated_by uuid references users\(id\)/i)
    expect(migration).toMatch(/traveler_management_settings_set_updated_at/i)
    expect(migration).toMatch(/tenant e o escopo da configuracao de viajantes sao imutaveis/i)
  })

  it('exposes guarded GET/PATCH with optimistic locking and audit', () => {
    expect(apiRoute).toContain('export async function GET')
    expect(apiRoute).toContain('export async function PATCH')
    expect(apiRoute).not.toMatch(/^\s*permission:/m)
    expect(apiRoute.indexOf('const { scopeType, scopeId } = await context.params'))
      .toBeLessThan(apiRoute.indexOf('const guard = await guardApiRequest'))
    expect(apiRoute.match(/scope: travelerManagementAuthorizationScope\(scopeType, scopeId\)/g))
      .toHaveLength(2)
    expect(apiRoute).toContain("requiredPermission: 'ver_funcionarios'")
    expect(apiRoute).toContain("requiredPermission: 'alterar_configuracoes'")
    expect(apiRoute).toContain("if (scopeType === 'company') return { companyId: scopeId }")
    expect(apiRoute).toContain("if (scopeType === 'group') return { groupId: scopeId }")
    expect(service).toContain("action: 'traveler.management_settings.update'")
    expect(service).toContain("entityType: 'traveler_management_settings'")
    expect(service).toContain('version = version + 1')
    expect(service).toContain("'TRAVELER_MANAGEMENT_VERSION_CONFLICT'")
  })
})
