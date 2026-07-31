import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { syncCorporateDirectoryFromStorage } from '@/lib/server/corporate-directory-sync'

import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL corporate directory synchronization', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 })
  const tenantId = randomUUID()
  const groupId = `group-${randomUUID()}`
  const companyA = `company-${randomUUID()}`
  const companyB = `company-${randomUUID()}`
  const employeeId = `employee-${randomUUID()}`

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Directory Sync Tenant', $2)`,
      [tenantId, `directory-sync-${tenantId}`],
    )
  })

  afterAll(async () => {
    await pool.query('delete from tenants where id = $1', [tenantId])
    await pool.end()
  })

  it('soft-deletes absent records and safely restores the same identifiers', async () => {
    await tenantTransaction(pool, tenantId, (client) => syncCorporateDirectoryFromStorage(
      client,
      tenantId,
      directoryState({ includeRemovedRecords: true }),
    ))

    await tenantTransaction(pool, tenantId, (client) => syncCorporateDirectoryFromStorage(
      client,
      tenantId,
      directoryState({ includeRemovedRecords: false }),
    ))

    const removed = await tenantTransaction(pool, tenantId, async (client) => {
      const group = await client.query<{ status: string; deleted: boolean }>(
        `select status, deleted_at is not null as deleted
         from business_groups where tenant_id = $1 and id = $2`,
        [tenantId, groupId],
      )
      const company = await client.query<{ status: string; deleted: boolean }>(
        `select status, deleted_at is not null as deleted
         from companies where tenant_id = $1 and id = $2`,
        [tenantId, companyB],
      )
      const employee = await client.query<{ status: string; deleted: boolean }>(
        `select status, deleted_at is not null as deleted
         from employees where tenant_id = $1 and id = $2`,
        [tenantId, employeeId],
      )
      const retained = await client.query<{ status: string; deleted: boolean; group_id: string | null }>(
        `select status, deleted_at is not null as deleted, group_id
         from companies where tenant_id = $1 and id = $2`,
        [tenantId, companyA],
      )
      return {
        group: group.rows[0],
        company: company.rows[0],
        employee: employee.rows[0],
        retained: retained.rows[0],
      }
    })

    expect(removed).toEqual({
      group: { status: 'inactive', deleted: true },
      company: { status: 'inactive', deleted: true },
      employee: { status: 'inactive', deleted: true },
      retained: { status: 'active', deleted: false, group_id: null },
    })

    await tenantTransaction(pool, tenantId, (client) => syncCorporateDirectoryFromStorage(
      client,
      tenantId,
      directoryState({ includeRemovedRecords: true }),
    ))

    const restored = await tenantTransaction(pool, tenantId, async (client) => {
      const group = await client.query<{ status: string; deleted: boolean }>(
        `select status, deleted_at is not null as deleted
         from business_groups where tenant_id = $1 and id = $2`,
        [tenantId, groupId],
      )
      const company = await client.query<{ status: string; deleted: boolean; group_id: string | null }>(
        `select status, deleted_at is not null as deleted, group_id
         from companies where tenant_id = $1 and id = $2`,
        [tenantId, companyB],
      )
      const employee = await client.query<{ status: string; deleted: boolean }>(
        `select status, deleted_at is not null as deleted
         from employees where tenant_id = $1 and id = $2`,
        [tenantId, employeeId],
      )
      return {
        group: group.rows[0],
        company: company.rows[0],
        employee: employee.rows[0],
      }
    })

    expect(restored).toEqual({
      group: { status: 'active', deleted: false },
      company: { status: 'active', deleted: false, group_id: groupId },
      employee: { status: 'active', deleted: false },
    })
  })

  function directoryState({ includeRemovedRecords }: { includeRemovedRecords: boolean }) {
    const now = new Date().toISOString()
    return {
      state: {
        gruposEmpresariais: includeRemovedRecords
          ? [{
              id: groupId,
              nome: 'Grupo de teste',
              ativo: true,
              empresa_ids: [companyA, companyB],
              created_at: now,
              updated_at: now,
            }]
          : [],
        empresas: [
          {
            id: companyA,
            nome: 'Empresa mantida',
            cnpj: '11111111000101',
            grupo_id: includeRemovedRecords ? groupId : null,
            ativa: true,
            created_at: now,
            updated_at: now,
          },
          ...(includeRemovedRecords
            ? [{
                id: companyB,
                nome: 'Empresa removida',
                cnpj: '22222222000102',
                grupo_id: groupId,
                ativa: true,
                created_at: now,
                updated_at: now,
              }]
            : []),
        ],
        funcionarios: includeRemovedRecords
          ? [{
              id: employeeId,
              company_id: companyB,
              codigo_identificacao: '987654',
              nome: 'Pessoa de teste',
              ativo: true,
              created_at: now,
              updated_at: now,
            }]
          : [],
      },
    }
  }
})

async function tenantTransaction<T>(
  pool: Pool,
  tenantId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
    const result = await operation(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
