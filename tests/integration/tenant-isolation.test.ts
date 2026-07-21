import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL tenant isolation', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantA = randomUUID()
  const tenantB = randomUUID()
  const planId = randomUUID()
  const companyA = `company-${randomUUID()}`
  const companyB = `company-${randomUUID()}`
  const demandA = `demand-${randomUUID()}`
  const demandB = `demand-${randomUUID()}`

  beforeAll(async () => {
    await pool.query(
      `insert into plans (id, plan_key, name) values ($1, $2, $3)`,
      [planId, `test-${planId}`, 'Integration test'],
    )
    await pool.query(
      `insert into tenants (id, name, slug) values ($1, 'Tenant A', $2), ($3, 'Tenant B', $4)`,
      [tenantA, `tenant-a-${tenantA}`, tenantB, `tenant-b-${tenantB}`],
    )
  })

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[tenantA, tenantB]])
    await pool.query('delete from plans where id = $1', [planId])
    await pool.end()
  })

  it('executa com papel de aplicacao sem privilegio para ignorar RLS', async () => {
    const role = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    )
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false })
  })

  it('isola leitura e bloqueia escrita com tenant divergente', async () => {
    await tenantTransaction(pool, tenantA, (client) =>
      client.query(`insert into app_kv (tenant_id, key, value) values ($1, 'isolation', '{"owner":"A"}')`, [tenantA]),
    )
    await tenantTransaction(pool, tenantB, (client) =>
      client.query(`insert into app_kv (tenant_id, key, value) values ($1, 'isolation', '{"owner":"B"}')`, [tenantB]),
    )

    const visibleA = await tenantTransaction(pool, tenantA, (client) =>
      client.query<{ tenant_id: string; value: { owner: string } }>('select tenant_id, value from app_kv where key = $1', ['isolation']),
    )
    expect(visibleA.rows).toEqual([{ tenant_id: tenantA, value: { owner: 'A' } }])

    await expect(tenantTransaction(pool, tenantA, (client) =>
      client.query(`insert into app_kv (tenant_id, key, value) values ($1, 'forbidden', '{}')`, [tenantB]),
    )).rejects.toThrow()
  })

  it('isola metadados de arquivo e contadores mensais', async () => {
    await tenantTransaction(pool, tenantA, async (client) => {
      await client.query(
        `insert into stored_files (tenant_id, uploaded_by, purpose, original_name, storage_key, mime_type, size_bytes, sha256)
         values ($1, null, 'voucher', 'a.pdf', $2, 'application/pdf', 4, $3)`,
        [tenantA, `${tenantA}/a.pdf`, 'a'.repeat(64)],
      )
      await client.query(
        `insert into tenant_usage_monthly (tenant_id, month_start, operations_created)
         values ($1, date_trunc('month', current_date)::date, 3)`,
        [tenantA],
      )
    })

    const visibleB = await tenantTransaction(pool, tenantB, async (client) => {
      const files = await client.query('select id from stored_files')
      const usage = await client.query('select operations_created from tenant_usage_monthly')
      return { files: files.rowCount, usage: usage.rowCount }
    })
    expect(visibleB).toEqual({ files: 0, usage: 0 })
  })

  it('isola empresas, demandas e agregacoes usadas pelos relatorios', async () => {
    await tenantTransaction(pool, tenantA, async (client) => {
      await client.query(
        `insert into companies (id, tenant_id, legal_name) values ($1, $2, 'Empresa A')`,
        [companyA, tenantA],
      )
      await client.query(
        `insert into demands (
           id, tenant_id, company_id, demand_number, service_type,
           passenger_name_snapshot, status, final_amount
         ) values ($1, $2, $3, $4, 'hotel', 'Pessoa A', 'completed', 125.50)`,
        [demandA, tenantA, companyA, `OS-A-${demandA}`],
      )
    })
    await tenantTransaction(pool, tenantB, async (client) => {
      await client.query(
        `insert into companies (id, tenant_id, legal_name) values ($1, $2, 'Empresa B')`,
        [companyB, tenantB],
      )
      await client.query(
        `insert into demands (
           id, tenant_id, company_id, demand_number, service_type,
           passenger_name_snapshot, status, final_amount
         ) values ($1, $2, $3, $4, 'air', 'Pessoa B', 'completed', 999.90)`,
        [demandB, tenantB, companyB, `OS-B-${demandB}`],
      )
    })

    const reportA = await tenantTransaction(pool, tenantA, async (client) => {
      const companies = await client.query<{ id: string }>('select id from companies order by id')
      const totals = await client.query<{ quantity: string; amount: string }>(
        'select count(*)::text as quantity, coalesce(sum(final_amount), 0)::text as amount from demands',
      )
      return { companyIds: companies.rows.map((row) => row.id), totals: totals.rows[0] }
    })

    expect(reportA.companyIds).toEqual([companyA])
    expect(reportA.totals).toEqual({ quantity: '1', amount: '125.50' })

    const crossTenantMutation = await tenantTransaction(pool, tenantA, async (client) => {
      const update = await client.query('update demands set final_amount = 1 where id = $1', [demandB])
      const remove = await client.query('delete from companies where id = $1', [companyB])
      return { updated: update.rowCount, removed: remove.rowCount }
    })
    expect(crossTenantMutation).toEqual({ updated: 0, removed: 0 })

    await expect(tenantTransaction(pool, tenantA, (client) =>
      client.query(
        `insert into demands (
           id, tenant_id, company_id, demand_number, service_type,
           passenger_name_snapshot, status
         ) values ($1, $2, $3, $4, 'hotel', 'Invalido', 'open')`,
        [`forbidden-${randomUUID()}`, tenantB, companyB, `OS-FORBIDDEN-${randomUUID()}`],
      ),
    )).rejects.toThrow()
  })
})

async function tenantTransaction<T>(pool: Pool, tenantId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
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
