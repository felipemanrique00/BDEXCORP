import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'deploy/postgres/migrations/0064_voucher_multitenant_primary_key.sql'),
  'utf8',
)
const voucherService = readFileSync(
  resolve(process.cwd(), 'lib/server/voucher-service.ts'),
  'utf8',
)
const offlineService = readFileSync(
  resolve(process.cwd(), 'lib/server/offline-travel-service.ts'),
  'utf8',
)

describe('voucher multitenant identity', () => {
  it('scopes the primary key and delivery relation by tenant', () => {
    expect(migration).toContain('primary key (tenant_id, id)')
    expect(migration).toContain('foreign key (tenant_id, voucher_id)')
    expect(migration).toContain('references vouchers(tenant_id, id)')
    expect(migration).not.toMatch(/primary key \(id\)/)
  })

  it('keeps voucher reads and writes tenant-scoped', () => {
    expect(voucherService).toContain('where tenant_id = $1 and id = $2')
    expect(offlineService).toContain('where tenant_id = $1 and emission_id = $2')
    expect(offlineService).toContain('where tenant_id = $1 and id = $2 and deleted_at is null')
  })
})
