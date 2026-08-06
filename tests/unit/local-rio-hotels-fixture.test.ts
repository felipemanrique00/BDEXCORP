import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const scriptPath = resolve(process.cwd(), 'scripts/seed-local-rio-hotels.mjs')
const source = readFileSync(scriptPath, 'utf8')

describe('local Rio hotel fixture safety contract', () => {
  it('refuses to execute with NODE_ENV=production before opening a connection', () => {
    const result = runFixture({
      NODE_ENV: 'production',
      MIGRATION_DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:55433/bdex_gap_closure',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('NODE_ENV=production')
  })

  it('refuses a remote PostgreSQL host', () => {
    const result = runFixture({
      NODE_ENV: 'development',
      MIGRATION_DATABASE_URL: 'postgresql://fixture:fixture@169.58.50.68:55433/bdex_gap_closure',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('host remoto nao permitido')
  })

  it('refuses a local database outside the dedicated development target', () => {
    const result = runFixture({
      NODE_ENV: 'development',
      MIGRATION_DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:55433/bdex_production',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('banco deve ser bdex_gap_closure')
  })

  it('uses stable records, transactional upserts and no destructive SQL', () => {
    expect(source).toContain("id: 'hotel_local_rio_centro_20260805'")
    expect(source).toContain("id: 'hotel_local_rio_copacabana_20260805'")
    expect(source).toContain("const TENANT_SLUG = 'cost-centers-local'")
    expect(source).toContain("const SUPPLIER_CODE = 'HOTEL-DEMO-OFFLINE'")
    expect(source).toContain("await client.query('begin')")
    expect(source).toContain("await client.query('commit')")
    expect(source).toContain('on conflict (id) do update set')
    expect(source).toContain('on conflict (tenant_id, hotel_id, supplier_id) do update set')
    expect(source).toContain('on conflict (tenant_id, hotel_id, code) do update set')
    expect(source).not.toMatch(/\b(?:delete|truncate|drop)\s+(?:from|table)\b/i)
  })
})

function runFixture(overrides: Record<string, string>) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: '',
      MIGRATION_DATABASE_URL: '',
      ...overrides,
    },
    timeout: 10_000,
  })
}
