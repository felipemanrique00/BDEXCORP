import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildTenantResetDeleteOrder,
  TENANT_BUSINESS_RESET_TABLES,
  TENANT_RESET_NULLABLE_EDGE_BREAKS,
  TENANT_RESET_PRESERVED_TABLES,
  TenantResetPolicyError,
  validateTenantResetSchema,
} from '@/lib/system-reset-policy'

describe('tenant reset policy', () => {
  it('classifies every tenant-scoped table declared by migrations', () => {
    const migrationTables = readTenantTablesFromMigrations()
    const classifiedTables = new Set([
      ...TENANT_BUSINESS_RESET_TABLES,
      ...TENANT_RESET_PRESERVED_TABLES,
    ])

    expect(new Set(migrationTables)).toEqual(classifiedTables)
    expect(TENANT_BUSINESS_RESET_TABLES).toEqual(expect.arrayContaining([
      'air_demand_details',
      'air_demand_legs',
      'air_quote_option_details',
      'air_quote_segments',
      'air_reservation_details',
      'air_reservation_segments',
      'air_emission_tickets',
      'approval_approver_group_members',
      'approval_approver_groups',
      'approval_audience_group_members',
      'approval_audience_groups',
      'approval_matrices',
    ]))
    expect(TENANT_BUSINESS_RESET_TABLES).toHaveLength(200)
    expect(TENANT_RESET_PRESERVED_TABLES).toHaveLength(18)
  })

  it('keeps reset and preserved tables disjoint', () => {
    const resetTables = new Set<string>(TENANT_BUSINESS_RESET_TABLES)
    expect(TENANT_RESET_PRESERVED_TABLES.filter((table) => resetTables.has(table))).toEqual([])
  })

  it('orders children before parents and handles only declared nullable cycles', () => {
    const order = buildTenantResetDeleteOrder([
      { childTable: 'vouchers', parentTable: 'reservations' },
      { childTable: 'reservations', parentTable: 'demands' },
      { childTable: 'demands', parentTable: 'policy_evaluations' },
      { childTable: 'policy_evaluations', parentTable: 'demands' },
    ])

    expect(order.indexOf('vouchers')).toBeLessThan(order.indexOf('reservations'))
    expect(order.indexOf('reservations')).toBeLessThan(order.indexOf('demands'))
    expect(order.indexOf('policy_evaluations')).toBeLessThan(order.indexOf('demands'))
    expect(TENANT_RESET_NULLABLE_EDGE_BREAKS).toContainEqual({
      childTable: 'demands',
      parentTable: 'policy_evaluations',
    })
  })

  it('can order the complete foreign-key graph declared by migrations', () => {
    const migrationSchema = readTenantSchemaFromMigrations()
    const order = buildTenantResetDeleteOrder(migrationSchema.foreignKeys)

    expect(order).toHaveLength(TENANT_BUSINESS_RESET_TABLES.length)
    expect(new Set(order)).toEqual(new Set(TENANT_BUSINESS_RESET_TABLES))
  })

  it('fails closed for a new unclassified table', () => {
    expect(() => validateTenantResetSchema({
      tenantTables: [
        ...TENANT_BUSINESS_RESET_TABLES,
        ...TENANT_RESET_PRESERVED_TABLES,
        'future_business_table',
      ],
      foreignKeys: [],
    })).toThrowError(TenantResetPolicyError)
  })

  it('fails closed when a preserved table references resettable data', () => {
    expect(() => validateTenantResetSchema({
      tenantTables: [
        ...TENANT_BUSINESS_RESET_TABLES,
        ...TENANT_RESET_PRESERVED_TABLES,
      ],
      foreignKeys: [
        { childTable: 'audit_logs', parentTable: 'companies' },
      ],
    })).toThrowError(/preservadas referenciam dados apagaveis/)
  })
})

function readTenantTablesFromMigrations(): string[] {
  return readTenantSchemaFromMigrations().tables
}

function readTenantSchemaFromMigrations(): {
  tables: string[]
  foreignKeys: Array<{ childTable: string; parentTable: string }>
} {
  const directory = path.resolve(process.cwd(), 'deploy', 'postgres', 'migrations')
  const tables = new Set<string>()
  const foreignKeys: Array<{ childTable: string; parentTable: string }> = []

  for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    const source = fs.readFileSync(path.join(directory, file), 'utf8').replace(/--.*$/gm, '')
    const pattern = /create table(?: if not exists)?\s+([a-z_][a-z0-9_]*)\s*\(/gi
    let match: RegExpExecArray | null

    while ((match = pattern.exec(source))) {
      let cursor = pattern.lastIndex
      let depth = 1
      while (cursor < source.length && depth > 0) {
        if (source[cursor] === '(') depth += 1
        if (source[cursor] === ')') depth -= 1
        cursor += 1
      }
      const body = source.slice(pattern.lastIndex, cursor - 1)
      if (/\btenant_id\b/i.test(body)) {
        tables.add(match[1])
        for (const reference of body.matchAll(/references\s+([a-z_][a-z0-9_]*)\s*\(/gi)) {
          foreignKeys.push({ childTable: match[1], parentTable: reference[1] })
        }
      }
      pattern.lastIndex = cursor
    }

    const alterForeignKeyPattern = /alter table\s+([a-z_][a-z0-9_]*)\s+add constraint\b[^;]*?\bforeign key\b[^;]*?\breferences\s+([a-z_][a-z0-9_]*)\s*\([^;]*?;/gi
    for (const reference of source.matchAll(alterForeignKeyPattern)) {
      foreignKeys.push({ childTable: reference[1], parentTable: reference[2] })
    }
    const alterTenantColumnPattern = /alter table\s+([a-z_][a-z0-9_]*)\s+add column(?: if not exists)?\s+tenant_id\b/gi
    for (const tenantTable of source.matchAll(alterTenantColumnPattern)) {
      tables.add(tenantTable[1])
    }
  }

  return {
    tables: [...tables].sort(),
    foreignKeys,
  }
}
