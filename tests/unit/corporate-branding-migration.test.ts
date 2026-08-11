import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'deploy/postgres/migrations/0073_corporate_branding_settings.sql'),
  'utf8',
)

describe('corporate branding migration', () => {
  it('models inherited group and company branding with document identity', () => {
    expect(migration).toContain('create table if not exists corporate_branding_settings')
    expect(migration).toContain("scope_type text not null check (scope_type in ('group', 'company'))")
    expect(migration).toContain('display_name text')
    expect(migration).toContain('logo_file_id uuid')
    expect(migration).toContain('primary_color text')
    expect(migration).toContain('accent_color text')
    expect(migration).toContain('sidebar_color text')
    expect(migration).toContain('document_legal_name text')
    expect(migration).toContain('document_number text')
    expect(migration).toContain('corporate_branding_settings_group_uidx')
    expect(migration).toContain('corporate_branding_settings_company_uidx')
  })

  it('binds private image assets to the exact tenant and scope', () => {
    expect(migration).toContain('create table if not exists corporate_branding_assets')
    expect(migration).toContain('primary key (tenant_id, file_id)')
    expect(migration).toContain('references stored_files(tenant_id, id) on delete cascade')
    expect(migration).toContain('references corporate_branding_assets(tenant_id, file_id) on delete restrict')
    expect(migration).toContain('validate_corporate_branding_logo_scope')
    expect(migration).toContain('A logomarca nao pertence ao escopo da identidade visual.')
  })

  it('enforces immutable scope, RLS, optimistic version and authorship', () => {
    expect(migration).toContain('version bigint not null default 1')
    expect(migration).toContain('created_by uuid references users(id)')
    expect(migration).toContain('updated_by uuid references users(id)')
    expect(migration).toContain('validate_corporate_branding_settings_scope')
    expect(migration).toContain('alter table corporate_branding_settings force row level security')
    expect(migration).toContain('alter table corporate_branding_assets force row level security')
    expect(migration).toContain("current_setting('app.tenant_id', true)")
  })
})
