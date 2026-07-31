import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0053_cost_center_catalog.sql'),
  'utf8',
)
const bootstrap = readFileSync(resolve(process.cwd(), 'scripts/bootstrap.mjs'), 'utf8')

function bootstrapRolePermissions(roleKey: string): string {
  const match = bootstrap.match(new RegExp(
    `key: '${roleKey}'[\\s\\S]*?permissions: \\[([\\s\\S]*?)\\n\\s*\\],`,
  ))
  if (!match?.[1]) throw new Error(`Perfil ${roleKey} ausente do bootstrap.`)
  return match[1]
}

describe('cost center catalog migration', () => {
  it('creates the canonical catalog and both explicit scope relations', () => {
    expect(migration).toMatch(/create table if not exists cost_center_plans\s*\(/i)
    expect(migration).toMatch(/create table if not exists cost_center_plan_companies\s*\(/i)
    expect(migration).toMatch(/create table if not exists cost_center_definitions\s*\(/i)
    expect(migration).toMatch(/create table if not exists cost_center_definition_companies\s*\(/i)
    expect(migration).toMatch(/scope_type text not null default 'plan'[\s\S]*selected_companies/i)
  })

  it('enforces tenant isolation, normalized codes and a three-level acyclic tree', () => {
    expect(migration).toMatch(/alter table %I force row level security/i)
    expect(migration).toMatch(/tenant_id = nullif\(current_setting\(''app\.tenant_id''/i)
    expect(migration).toMatch(/lower\(btrim\(code::text\)\)/i)
    expect(migration).toMatch(/hierarchy_level between 1 and 3/i)
    expect(migration).toMatch(/pg_advisory_xact_lock/i)
    expect(migration).toMatch(/hierarquia de centros de custo nao pode conter ciclos/i)
  })

  it('keeps company projections and hardens their consumers with composite keys', () => {
    expect(migration).toMatch(/add column if not exists plan_id uuid/i)
    expect(migration).toMatch(/add column if not exists definition_id uuid/i)
    expect(migration).toMatch(/create unique index[^;]+\(tenant_id, company_id, definition_id\)/i)
    expect(migration).toMatch(/foreign key \(tenant_id, id, default_cost_center_id\)/i)
    expect(migration).toMatch(/foreign key \(tenant_id, company_id, cost_center_id\)[\s\S]*references cost_centers\(tenant_id, company_id, id\)/i)
    expect(migration).toMatch(/budgets_company_cost_center_fk/i)
  })

  it('provisions companies idempotently and fails instead of silently corrupting legacy data', () => {
    expect(migration).toMatch(/create or replace function ensure_company_cost_center_plan/i)
    expect(migration).toMatch(/after insert on companies/i)
    expect(migration).toMatch(/on conflict \(tenant_id, plan_id, company_id\) do nothing/i)
    expect(migration).toMatch(/codigo duplicado sem diferenciar maiusculas\/minusculas/i)
    expect(migration).toMatch(/hierarquia legada excede tres niveis/i)
    expect(migration).not.toMatch(/\b(?:drop\s+table|drop\s+column|truncate\s+table)\b/i)
  })

  it('keeps new-tenant bootstrap permissions aligned with the catalog migration', () => {
    for (const roleKey of ['agent', 'operator', 'financial_manager', 'requester', 'readonly']) {
      expect(bootstrapRolePermissions(roleKey)).toContain("'ver_centros_custo'")
      expect(bootstrapRolePermissions(roleKey)).not.toContain("'gerenciar_centros_custo'")
    }
    for (const roleKey of ['supervisor', 'company_admin']) {
      expect(bootstrapRolePermissions(roleKey)).toContain("'ver_centros_custo'")
      expect(bootstrapRolePermissions(roleKey)).toContain("'gerenciar_centros_custo'")
    }
  })
})
