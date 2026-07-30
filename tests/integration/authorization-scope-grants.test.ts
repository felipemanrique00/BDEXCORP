import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL fine-grained authorization integrity', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantA = randomUUID()
  const tenantB = randomUUID()
  const userA = randomUUID()
  const userB = randomUUID()
  const roleA = randomUUID()
  const roleB = randomUUID()
  const membershipA = randomUUID()
  const membershipB = randomUUID()
  const companyA = `company-${randomUUID()}`
  const companyB = `company-${randomUUID()}`
  const costCenterA = randomUUID()
  const costCenterB = randomUUID()

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Authorization Tenant A', $2), ($3, 'Authorization Tenant B', $4)`,
      [tenantA, `authorization-a-${tenantA}`, tenantB, `authorization-b-${tenantB}`],
    )
    await pool.query(
      `insert into users (id, email, name)
       values ($1, $2, 'Authorization User A'), ($3, $4, 'Authorization User B')`,
      [userA, `authorization-a-${userA}@test.invalid`, userB, `authorization-b-${userB}@test.invalid`],
    )
    await tenantTransaction(pool, tenantA, async (client) => {
      await client.query(
        `insert into roles (id, tenant_id, role_key, name)
         values ($1, $2, 'company_admin', 'Company admin A')`,
        [roleA, tenantA],
      )
      await client.query(
        `insert into tenant_memberships (id, tenant_id, user_id, role_id)
         values ($1, $2, $3, $4)`,
        [membershipA, tenantA, userA, roleA],
      )
      await client.query(
        `insert into companies (id, tenant_id, legal_name) values ($1, $2, 'Company A')`,
        [companyA, tenantA],
      )
      await client.query(
        `insert into cost_centers (id, tenant_id, company_id, code, name)
         values ($1, $2, $3, 'CC-A', 'Cost center A')`,
        [costCenterA, tenantA, companyA],
      )
    })
    await tenantTransaction(pool, tenantB, async (client) => {
      await client.query(
        `insert into roles (id, tenant_id, role_key, name)
         values ($1, $2, 'company_admin', 'Company admin B')`,
        [roleB, tenantB],
      )
      await client.query(
        `insert into tenant_memberships (id, tenant_id, user_id, role_id)
         values ($1, $2, $3, $4)`,
        [membershipB, tenantB, userB, roleB],
      )
      await client.query(
        `insert into companies (id, tenant_id, legal_name) values ($1, $2, 'Company B')`,
        [companyB, tenantB],
      )
      await client.query(
        `insert into cost_centers (id, tenant_id, company_id, code, name)
         values ($1, $2, $3, 'CC-B', 'Cost center B')`,
        [costCenterB, tenantB, companyB],
      )
    })
  })

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[tenantA, tenantB]])
    await pool.query('delete from users where id = any($1::uuid[])', [[userA, userB]])
    await pool.end()
  })

  it('resolve automaticamente a empresa do centro de custo', async () => {
    const grant = await tenantTransaction(pool, tenantA, async (client) => {
      const result = await client.query<{ company_id: string }>(
        `insert into authorization_scope_grants (
           tenant_id, membership_id, effect, permission_key, resource_type,
           actions, scope_type, scope_id, is_boundary
         ) values ($1, $2, 'allow', 'ver_demandas', 'demands',
                   '{read}', 'cost_center', $3, true)
         returning company_id`,
        [tenantA, membershipA, costCenterA],
      )
      return result.rows[0]
    })

    expect(grant.company_id).toBe(companyA)
  })

  it('impede vinculo entre centro de custo e empresa de outro tenant', async () => {
    await expect(tenantTransaction(pool, tenantA, (client) => client.query(
      `insert into authorization_scope_grants (
         tenant_id, membership_id, effect, permission_key, resource_type,
         actions, scope_type, scope_id, company_id
       ) values ($1, $2, 'allow', 'ver_demandas', 'demands',
                 '{read}', 'cost_center', $3, $4)`,
      [tenantA, membershipA, costCenterB, companyB],
    ))).rejects.toThrow()
  })

  it('isola os limites de autorizacao por RLS', async () => {
    await tenantTransaction(pool, tenantB, (client) => client.query(
      `insert into authorization_scope_grants (
         tenant_id, membership_id, effect, permission_key, resource_type,
         actions, scope_type, scope_id, company_id
       ) values ($1, $2, 'deny', 'ver_financeiro', 'finance',
                 '{read}', 'company', $3, $3)`,
      [tenantB, membershipB, companyB],
    ))

    const visibleA = await tenantTransaction(pool, tenantA, (client) =>
      client.query<{ tenant_id: string }>('select tenant_id from authorization_scope_grants'),
    )
    expect(visibleA.rows.every((row) => row.tenant_id === tenantA)).toBe(true)

    await expect(tenantTransaction(pool, tenantA, (client) => client.query(
      `insert into authorization_scope_grants (
         tenant_id, membership_id, effect, permission_key, resource_type,
         actions, scope_type, scope_id
       ) values ($1, $2, 'allow', 'ver_demandas', 'demands',
                 '{read}', 'tenant', $3)`,
      [tenantB, membershipB, tenantB],
    ))).rejects.toThrow()
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
