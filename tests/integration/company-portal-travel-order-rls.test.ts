import { randomUUID } from 'node:crypto'

import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL company portal travel-order RLS boundary', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantId = randomUUID()
  const userId = randomUUID()
  const roleId = randomUUID()
  const membershipId = randomUUID()
  const orderId = randomUUID()
  const itemId = randomUUID()
  const groundOrderId = randomUUID()
  const carItemId = randomUUID()
  const busItemId = randomUUID()
  const companyId = `company-${randomUUID()}`
  const requesterId = `requester-${randomUUID()}`
  const demandId = `demand-${randomUUID()}`
  const carDemandId = `demand-${randomUUID()}`
  const busDemandId = `demand-${randomUUID()}`

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Travel Order RLS Tenant', $2)`,
      [tenantId, `travel-order-rls-${tenantId}`],
    )
    await pool.query(
      `insert into users (id, email, name, status, email_verified_at)
       values ($1, $2, 'Solicitante RLS', 'active', now())`,
      [userId, `travel-order-rls-${userId}@test.invalid`],
    )

    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `insert into roles (id, tenant_id, role_key, name)
         values ($1, $2, $3, 'Solicitante de teste')`,
        [roleId, tenantId, `requester-${roleId}`],
      )
      await client.query(
        `insert into companies (id, tenant_id, legal_name, trade_name, status)
         values ($1, $2, 'Empresa RLS SA', 'Empresa RLS', 'active')`,
        [companyId, tenantId],
      )
      await client.query(
        `insert into tenant_memberships (
           id, tenant_id, user_id, role_id, status, profile_key,
           company_id, allowed_company_ids
         ) values ($1, $2, $3, $4, 'active', 'solicitante', $5, array[$5]::text[])`,
        [membershipId, tenantId, userId, roleId, companyId],
      )
      await client.query(
        `insert into requesters (
           id, tenant_id, company_id, user_id, name, email, status
         ) values ($1, $2, $3, $4, 'Solicitante RLS', $5, 'active')`,
        [requesterId, tenantId, companyId, userId, `requester-${userId}@test.invalid`],
      )
      await client.query(
        `insert into company_portal_travel_orders (
           id, tenant_id, company_id, requester_id, requester_user_id,
           requester_membership_id, order_number, status, version
         ) values ($1, $2, $3, $4, $5, $6, $7, 'draft', 1)`,
        [
          orderId, tenantId, companyId, requesterId, userId,
          membershipId, `PED-RLS-${orderId}`,
        ],
      )
      await client.query(
        `insert into company_portal_travel_order_items (
           id, tenant_id, order_id, company_id, service_type, position,
           demand_payload, payload_hash, completeness_issues
         ) values ($1, $2, $3, $4, 'air', 1, '{}'::jsonb, $5, '[]'::jsonb)`,
        [itemId, tenantId, orderId, companyId, 'a'.repeat(64)],
      )

      // This GUC is transaction-local and is the only path used by the
      // materializer to create/link a private child before publication.
      await client.query(
        `select set_config('app.allow_hidden_travel_order_child', 'true', true)`,
      )
      await client.query(
        `insert into demands (
           id, tenant_id, company_id, requester_id, demand_number,
           service_type, passenger_name_snapshot, status, priority,
           lifecycle_status, lifecycle_version, travel_order_id,
           travel_order_item_id
         ) values (
           $1, $2, $3, $4, $5,
           'Aereo', 'Viajante RLS', 'pendente', 'normal',
           'draft', 1, $6, $7
         )`,
        [demandId, tenantId, companyId, requesterId, `OS-RLS-${demandId}`, orderId, itemId],
      )
      await client.query(
        `update company_portal_travel_order_items
         set child_demand_id = $4
         where tenant_id = $1 and order_id = $2 and id = $3`,
        [tenantId, orderId, itemId, demandId],
      )
    })
  })

  afterAll(async () => {
    try {
      await tenantTransaction(pool, tenantId, async (client) => {
        await client.query(`select set_config('app.tenant_reset', 'on', true)`)
        await client.query(`select set_config('app.allow_hidden_travel_order_child', 'true', true)`)
        await client.query(
          `update company_portal_travel_order_items
           set child_demand_id = null
           where tenant_id = $1 and order_id = any($2::uuid[])`,
          [tenantId, [orderId, groundOrderId]],
        )
        await client.query(
          'delete from demands where tenant_id = $1 and id = any($2::text[])',
          [tenantId, [demandId, carDemandId, busDemandId]],
        )
        await client.query(
          'delete from company_portal_travel_orders where tenant_id = $1 and id = any($2::uuid[])',
          [tenantId, [orderId, groundOrderId]],
        )
        await client.query('delete from tenants where id = $1', [tenantId])
      })
      await pool.query('delete from users where id = $1', [userId])
    } finally {
      await pool.end()
    }
  })

  it('runs through the non-superuser application role without BYPASSRLS', async () => {
    const role = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    )
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false })
  })

  it('hides and blocks the linked child while its parent is draft', async () => {
    const hidden = await tenantTransaction(pool, tenantId, async (client) => {
      const read = await client.query('select id from demands where id = $1', [demandId])
      const update = await client.query(
        `update demands set observations = 'must-not-write' where id = $1`,
        [demandId],
      )
      return { read: read.rowCount, updated: update.rowCount }
    })
    expect(hidden).toEqual({ read: 0, updated: 0 })

    const internal = await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `select set_config('app.allow_hidden_travel_order_child', 'true', true)`,
      )
      return client.query<{ id: string; requester_id: string | null }>(
        'select id, requester_id from demands where id = $1',
        [demandId],
      )
    })
    expect(internal.rows).toEqual([{ id: demandId, requester_id: requesterId }])

    // A fresh transaction proves the LOCAL bypass did not leak through Pool.
    const hiddenAgain = await tenantTransaction(pool, tenantId, (client) => (
      client.query('select id from demands where id = $1', [demandId])
    ))
    expect(hiddenAgain.rowCount).toBe(0)
  })

  it('makes the same child visible after publication without losing requester ownership', async () => {
    await tenantTransaction(pool, tenantId, (client) => client.query(
      `update company_portal_travel_orders
       set status = 'submitted', submitted_at = now(), version = version + 1
       where tenant_id = $1 and id = $2 and status = 'draft'`,
      [tenantId, orderId],
    ))

    const visible = await tenantTransaction(pool, tenantId, (client) => client.query<{
      id: string
      requester_id: string | null
      requester_user_id: string | null
    }>(
      `select demand.id, demand.requester_id, requester.user_id as requester_user_id
       from demands demand
       left join requesters requester
         on requester.tenant_id = demand.tenant_id and requester.id = demand.requester_id
       where demand.id = $1`,
      [demandId],
    ))
    expect(visible.rows).toEqual([{
      id: demandId,
      requester_id: requesterId,
      requester_user_id: userId,
    }])
  })

  it('accepts car and bus children after 0083 and keeps both private until publication', async () => {
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `insert into company_portal_travel_orders (
           id, tenant_id, company_id, requester_id, requester_user_id,
           requester_membership_id, order_number, status, version
         ) values ($1, $2, $3, $4, $5, $6, $7, 'draft', 1)`,
        [
          groundOrderId, tenantId, companyId, requesterId, userId,
          membershipId, `PED-GROUND-RLS-${groundOrderId}`,
        ],
      )
      await client.query(
        `insert into company_portal_travel_order_items (
           id, tenant_id, order_id, company_id, service_type, position,
           demand_payload, payload_hash, completeness_issues
         ) values
           ($1, $3, $4, $5, 'car', 1, '{}'::jsonb, $6, '[]'::jsonb),
           ($2, $3, $4, $5, 'bus', 2, '{}'::jsonb, $7, '[]'::jsonb)`,
        [carItemId, busItemId, tenantId, groundOrderId, companyId, 'c'.repeat(64), 'b'.repeat(64)],
      )
      await client.query(`select set_config('app.allow_hidden_travel_order_child', 'true', true)`)
      await client.query(
        `insert into demands (
           id, tenant_id, company_id, requester_id, demand_number,
           service_type, passenger_name_snapshot, status, priority,
           lifecycle_status, lifecycle_version, travel_order_id,
           travel_order_item_id
         ) values
           ($1, $3, $4, $5, $6, $7, 'Motorista RLS', 'pendente', 'normal',
            'draft', 1, $8, $9),
           ($2, $3, $4, $5, $10, $11, 'Viajante RLS', 'pendente', 'normal',
            'draft', 1, $8, $12)`,
        [
          carDemandId, busDemandId, tenantId, companyId, requesterId,
          `OS-RLS-${carDemandId}`, 'Locação', groundOrderId, carItemId,
          `OS-RLS-${busDemandId}`, 'Rodoviário', busItemId,
        ],
      )
      await client.query(
        `update company_portal_travel_order_items item
         set child_demand_id = case item.id when $3::uuid then $5 else $6 end
         where item.tenant_id = $1 and item.order_id = $2
           and item.id = any($4::uuid[])`,
        [tenantId, groundOrderId, carItemId, [carItemId, busItemId], carDemandId, busDemandId],
      )
    })

    await expect(tenantTransaction(pool, tenantId, async (client) => {
      await client.query(`select set_config('app.allow_hidden_travel_order_child', 'true', true)`)
      await client.query(
        `insert into demands (
           id, tenant_id, company_id, requester_id, demand_number,
           service_type, passenger_name_snapshot, status, priority,
           lifecycle_status, lifecycle_version, travel_order_id,
           travel_order_item_id
         ) values (
           $1, $2, $3, $4, $5, 'Carro', 'Servico divergente', 'pendente', 'normal',
           'draft', 1, $6, $7
         )`,
        [
          `demand-${randomUUID()}`, tenantId, companyId, requesterId,
          `OS-RLS-MISMATCH-${randomUUID()}`, groundOrderId, busItemId,
        ],
      )
    })).rejects.toThrow(/Servico da demanda nao corresponde ao item do pedido/)

    const hidden = await tenantTransaction(pool, tenantId, (client) => client.query(
      'select id from demands where id = any($1::text[])',
      [[carDemandId, busDemandId]],
    ))
    expect(hidden.rowCount).toBe(0)

    const internal = await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(`select set_config('app.allow_hidden_travel_order_child', 'true', true)`)
      return client.query<{ id: string; service_type: string }>(
        'select id, service_type from demands where id = any($1::text[]) order by id',
        [[carDemandId, busDemandId]],
      )
    })
    expect(internal.rows).toHaveLength(2)
    expect(internal.rows).toEqual(expect.arrayContaining([
      { id: carDemandId, service_type: 'Locação' },
      { id: busDemandId, service_type: 'Rodoviário' },
    ]))

    await tenantTransaction(pool, tenantId, (client) => client.query(
      `update company_portal_travel_orders
       set status = 'submitted', submitted_at = now(), version = version + 1
       where tenant_id = $1 and id = $2 and status = 'draft'`,
      [tenantId, groundOrderId],
    ))
    const visible = await tenantTransaction(pool, tenantId, (client) => client.query(
      'select id from demands where id = any($1::text[])',
      [[carDemandId, busDemandId]],
    ))
    expect(visible.rowCount).toBe(2)
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
