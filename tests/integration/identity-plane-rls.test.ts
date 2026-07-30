import { randomBytes, randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL identity plane RLS', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantA = randomUUID()
  const tenantB = randomUUID()
  const userA = randomUUID()
  const userB = randomUUID()
  const platformAdmin = randomUUID()
  const roleA = randomUUID()
  const roleB = randomUUID()
  const membershipA = randomUUID()
  const membershipB = randomUUID()
  const planId = randomUUID()
  const sessionHashA = randomBytes(32).toString('hex')
  const sessionHashB = randomBytes(32).toString('hex')
  const inviteHashA = randomBytes(32).toString('hex')
  const inviteHashB = randomBytes(32).toString('hex')

  beforeAll(async () => {
    await pool.query(
      `insert into plans (id, plan_key, name)
       values ($1, $2, 'Identity RLS Plan')`,
      [planId, `identity-rls-${planId}`],
    )
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'Identity Tenant A', $2), ($3, 'Identity Tenant B', $4)`,
      [tenantA, `identity-a-${tenantA}`, tenantB, `identity-b-${tenantB}`],
    )
    await pool.query(
      `insert into users (id, email, name, platform_admin, status)
       values
         ($1, $2, 'Identity User A', false, 'active'),
         ($3, $4, 'Identity User B', false, 'active'),
         ($5, $6, 'Identity Platform Admin', true, 'active')`,
      [
        userA,
        `identity-a-${userA}@test.invalid`,
        userB,
        `identity-b-${userB}@test.invalid`,
        platformAdmin,
        `identity-platform-${platformAdmin}@test.invalid`,
      ],
    )
    await seedTenant(tenantA, userA, roleA, membershipA, sessionHashA, inviteHashA)
    await seedTenant(tenantB, userB, roleB, membershipB, sessionHashB, inviteHashB)
  })

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await withContext({ tenantId }, async (client) => {
        await client.query('delete from tenant_subscriptions where tenant_id = $1', [tenantId])
        await client.query('delete from tenants where id = $1', [tenantId])
      })
    }
    await pool.query(
      'delete from users where id = any($1::uuid[])',
      [[userA, userB, platformAdmin]],
    )
    await pool.query('delete from plans where id = $1', [planId])
    await pool.end()
  })

  it('denies tenant identity rows without a database security context', async () => {
    const result = await pool.query<{ source: string; tenant_id: string }>(
      `select 'membership' as source, tenant_id from tenant_memberships
       union all select 'subscription', tenant_id from tenant_subscriptions
       union all select 'invite', tenant_id from user_invites
       union all select 'session', tenant_id from user_sessions
       union all select 'role', tenant_id from roles where tenant_id is not null`,
    )

    const testTenantIds = new Set<string>([tenantA, tenantB])
    expect(result.rows.filter((row) => testTenantIds.has(row.tenant_id))).toEqual([])
  })

  it('isolates tenant context and rejects a cross-tenant role insert', async () => {
    const visible = await withContext({ tenantId: tenantA }, (client) =>
      client.query<{ tenant_id: string }>(
        `select tenant_id from tenant_memberships
         union all select tenant_id from tenant_subscriptions
         union all select tenant_id from user_invites
         union all select tenant_id from user_sessions
         union all select tenant_id from roles where tenant_id is not null`,
      ),
    )
    expect(visible.rows.length).toBeGreaterThan(0)
    expect(visible.rows.every((row) => row.tenant_id === tenantA)).toBe(true)

    await expect(withContext({ tenantId: tenantA }, (client) =>
      client.query(
        `insert into roles (id, tenant_id, role_key, name)
         values ($1, $2, 'cross_tenant_denied', 'Cross tenant denied')`,
        [randomUUID(), tenantB],
      ),
    )).rejects.toThrow(/row-level security/i)
  })

  it('limits identity and session lookups to the resolved user', async () => {
    const identityRows = await withContext({ identityUserId: userA }, (client) =>
      client.query<{ tenant_id: string }>(
        `select tenant_id from tenant_memberships
         union all select tenant_id from tenant_subscriptions
         union all select tenant_id from roles where tenant_id is not null`,
      ),
    )
    expect(identityRows.rows.length).toBeGreaterThan(0)
    expect(identityRows.rows.every((row) => row.tenant_id === tenantA)).toBe(true)

    const sessionRows = await withContext({ sessionTokenHash: sessionHashA }, (client) =>
      client.query<{ tenant_id: string }>(
        `select tenant_id from tenant_memberships
         union all select tenant_id from tenant_subscriptions
         union all select tenant_id from user_sessions
         union all select tenant_id from roles where tenant_id is not null`,
      ),
    )
    expect(sessionRows.rows.length).toBeGreaterThan(0)
    expect(sessionRows.rows.every((row) => row.tenant_id === tenantA)).toBe(true)
  })

  it('exposes only the invite matching the opaque hash', async () => {
    const invites = await withContext({ inviteTokenHash: inviteHashA }, (client) =>
      client.query<{ tenant_id: string; token_hash: string }>(
        'select tenant_id, token_hash from user_invites',
      ),
    )

    expect(invites.rows).toEqual([{ tenant_id: tenantA, token_hash: inviteHashA }])
  })

  it('allows global identity reads only for an active platform administrator', async () => {
    const denied = await withContext({ platformAdminUserId: userA }, (client) =>
      client.query('select tenant_id from tenant_subscriptions'),
    )
    expect(denied.rows).toEqual([])

    const allowed = await withContext({ platformAdminUserId: platformAdmin }, (client) =>
      client.query<{ tenant_id: string }>(
        'select tenant_id from tenant_subscriptions where tenant_id = any($1::uuid[])',
        [[tenantA, tenantB]],
      ),
    )
    expect(new Set(allowed.rows.map((row) => row.tenant_id))).toEqual(new Set([tenantA, tenantB]))
  })

  async function seedTenant(
    tenantId: string,
    userId: string,
    roleId: string,
    membershipId: string,
    sessionHash: string,
    inviteHash: string,
  ): Promise<void> {
    await withContext({ tenantId }, async (client) => {
      await client.query(
        `insert into tenant_subscriptions (tenant_id, plan_id, status)
         values ($1, $2, 'active')`,
        [tenantId, planId],
      )
      await client.query(
        `insert into roles (id, tenant_id, role_key, name)
         values ($1, $2, 'identity_test', 'Identity test role')`,
        [roleId, tenantId],
      )
      await client.query(
        `insert into tenant_memberships (id, tenant_id, user_id, role_id)
         values ($1, $2, $3, $4)`,
        [membershipId, tenantId, userId, roleId],
      )
      await client.query(
        `insert into user_sessions (
           tenant_id, membership_id, user_id, token_hash, expires_at
         ) values ($1, $2, $3, $4, now() + interval '1 hour')`,
        [tenantId, membershipId, userId, sessionHash],
      )
      await client.query(
        `insert into user_invites (
           tenant_id, user_id, membership_id, token_hash, expires_at
         ) values ($1, $2, $3, $4, now() + interval '1 hour')`,
        [tenantId, userId, membershipId, inviteHash],
      )
    })
  }

  async function withContext<T>(
    context: {
      tenantId?: string
      identityUserId?: string
      sessionTokenHash?: string
      inviteTokenHash?: string
      platformAdminUserId?: string
    },
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect()
    try {
      await client.query('begin')
      for (const [name, value] of Object.entries({
        'app.tenant_id': context.tenantId,
        'app.identity_user_id': context.identityUserId,
        'app.session_token_hash': context.sessionTokenHash,
        'app.invite_token_hash': context.inviteTokenHash,
        'app.platform_admin_user_id': context.platformAdminUserId,
      })) {
        if (value) await client.query('select set_config($1, $2, true)', [name, value])
      }
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
})
