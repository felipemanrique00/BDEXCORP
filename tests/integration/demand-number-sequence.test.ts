import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { nextDemandNumber } from '@/lib/server/demand-service'

import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('demand number sequence', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 })
  const tenantId = randomUUID()
  const companyId = `company-${randomUUID()}`
  const compactDate = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Demand sequence tenant', $2)`,
      [tenantId, `demand-sequence-${tenantId}`],
    )
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `insert into companies (id, tenant_id, legal_name)
         values ($1, $2, 'Demand sequence company')`,
        [companyId, tenantId],
      )
      await client.query(
        `insert into demands (
           id, tenant_id, company_id, demand_number, service_type,
           passenger_name_snapshot, status
         ) values ($1, $2, $3, $4, 'hotel', 'Legacy traveler', 'completed')`,
        [`demand-${randomUUID()}`, tenantId, companyId, `OS-${compactDate}-0254`],
      )
    })
  })

  afterAll(async () => {
    await pool.query('delete from tenants where id = $1', [tenantId])
    await pool.end()
  })

  it('continua depois do maior numero legado quando o contador ainda nao existe', async () => {
    const first = await tenantTransaction(
      pool,
      tenantId,
      (client) => nextDemandNumber(client, tenantId),
    )
    const second = await tenantTransaction(
      pool,
      tenantId,
      (client) => nextDemandNumber(client, tenantId),
    )

    expect(first).toBe(`OS-${compactDate}-0255`)
    expect(second).toBe(`OS-${compactDate}-0256`)
  })
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
