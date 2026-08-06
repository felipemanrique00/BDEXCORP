import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const scriptPath = resolve(process.cwd(), 'scripts/seed-staging-offline-catalog.mjs')
const source = readFileSync(scriptPath, 'utf8')
const validGuardEnvironment = {
  NODE_ENV: 'production',
  APP_ENVIRONMENT: 'staging',
  APP_URL: 'https://staging.bdextravel.com.br',
  STAGING_OFFLINE_CATALOG_SEED_CONFIRM: 'bdex-homologacao:offline-catalog',
  MIGRATION_DATABASE_URL: 'postgresql://bbt_staging_admin:fixture@staging_postgres:5432/bbt_corporativo_staging',
}

describe('staging offline catalog fixture safety contract', () => {
  it('requires production mode inside the staging environment', () => {
    const result = runFixture({ ...validGuardEnvironment, NODE_ENV: 'development' })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('NODE_ENV deve ser production')
  })

  it('requires the exact staging environment and URL', () => {
    const wrongEnvironment = runFixture({ ...validGuardEnvironment, APP_ENVIRONMENT: 'production' })
    const wrongUrl = runFixture({ ...validGuardEnvironment, APP_URL: 'https://bdextravel.com.br' })

    expect(wrongEnvironment.status).not.toBe(0)
    expect(wrongEnvironment.stderr).toContain('APP_ENVIRONMENT deve ser staging')
    expect(wrongUrl.status).not.toBe(0)
    expect(wrongUrl.stderr).toContain('APP_URL deve ser https://staging.bdextravel.com.br')
  })

  it('requires an explicit confirmation and never falls back to DATABASE_URL', () => {
    const withoutConfirmation = runFixture({
      ...validGuardEnvironment,
      STAGING_OFFLINE_CATALOG_SEED_CONFIRM: '',
    })
    const withoutMigrationUrl = runFixture({
      ...validGuardEnvironment,
      MIGRATION_DATABASE_URL: '',
      DATABASE_URL: 'postgresql://application:application@127.0.0.1:1/forbidden',
    })

    expect(withoutConfirmation.status).not.toBe(0)
    expect(withoutConfirmation.stderr).toContain('STAGING_OFFLINE_CATALOG_SEED_CONFIRM')
    expect(withoutMigrationUrl.status).not.toBe(0)
    expect(withoutMigrationUrl.stderr).toContain('MIGRATION_DATABASE_URL obrigatoria')
    expect(source).not.toContain('process.env.DATABASE_URL')
  })

  it('pins the administrative connection to the dedicated staging database', () => {
    const productionHost = runFixture({
      ...validGuardEnvironment,
      MIGRATION_DATABASE_URL: 'postgresql://bbt_staging_admin:fixture@production_postgres:5432/bbt_corporativo_staging',
    })
    const productionDatabase = runFixture({
      ...validGuardEnvironment,
      MIGRATION_DATABASE_URL: 'postgresql://bbt_staging_admin:fixture@staging_postgres:5432/bbt_corporativo_production',
    })
    const applicationUser = runFixture({
      ...validGuardEnvironment,
      MIGRATION_DATABASE_URL: 'postgresql://bbt_staging_app:fixture@staging_postgres:5432/bbt_corporativo_staging',
    })

    for (const result of [productionHost, productionDatabase, applicationUser]) {
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('MIGRATION_DATABASE_URL deve apontar para')
    }
  })

  it('pins the audited tenant, company and group allowlist', () => {
    expect(source).toContain("tenantId: 'fa5fe929-fa02-4d84-8d07-3f04882a978d'")
    expect(source).toContain("tenantSlug: 'bdex-homologacao'")
    expect(source).toContain("companyId: 'emp-cfc5d0d0-8732-4a44-953c-cc4c9a0ff832'")
    expect(source).toContain("companyName: 'QA EMPRESA HOMOLOGACAO'")
    expect(source).toContain("groupId: 'grp-819fc4c3-2b88-4600-8f1f-c65a331bad02'")
    expect(source).toContain("groupName: 'QA GRUPO HOMOLOGACAO'")
    expect(source).toContain("const REQUIRED_MIGRATION = '0068_commercial_supplier_offline_catalog.sql'")
  })

  it('is transactional, locked, idempotent and non-destructive', () => {
    expect(source).toContain("await client.query('begin')")
    expect(source).toContain('pg_advisory_xact_lock')
    expect(source).toContain("set_config('app.tenant_id'")
    expect(source).toContain("await client.query('set constraints all immediate')")
    expect(source).toContain("await client.query('commit')")
    expect(source).toContain("await client.query('rollback')")
    expect(source.match(/is distinct from row\(/g)).toHaveLength(5)
    expect(source).toContain('where hotel_supplier_rate_scopes.deleted_at is not null')
    expect(source).toContain("amenities->>'fixture'")
    expect(source).toContain("commercial_terms->>'fixture'")
    expect(source).toContain("metadata->>'fixture'")
    expect(source.match(/on conflict \(id\) do update set/g)?.length).toBeGreaterThanOrEqual(5)
    expect(source).not.toMatch(/\b(?:delete|truncate|drop)\b/i)
  })

  it('creates only fictitious catalog data and exposes a safe stdout contract', () => {
    expect(source).toContain("code: 'STG-HOTEL-FICTICIO'")
    expect(source).toContain("source = 'staging_fixture'")
    expect(source).toContain("scopeType: 'global'")
    expect(source).toContain("scopeType: 'restricted'")
    expect(source.match(/roomCode: 'SGL-CM'/g)).toHaveLength(2)
    expect(source).toContain("await upsertScope(client, context, rate.id, 'company', TARGET.companyId)")
    expect(source).toContain("await upsertScope(client, context, rate.id, 'group', TARGET.groupId)")
    expect(source).toContain('fixtureCounts:')
    expect(source).toContain('suppliers: 1')
    expect(source.match(/console\.log\(/g)).toHaveLength(1)
    expect(source).not.toMatch(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)
  })
})

function runFixture(overrides: Record<string, string>) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      APP_ENVIRONMENT: '',
      APP_URL: '',
      DATABASE_URL: '',
      MIGRATION_DATABASE_URL: '',
      STAGING_OFFLINE_CATALOG_SEED_CONFIRM: '',
      ...overrides,
    },
    timeout: 10_000,
  })
}
