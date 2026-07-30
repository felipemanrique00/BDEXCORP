import { randomUUID } from 'node:crypto'

import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { closeDatabasePool } from '@/lib/server/database'
import { confirmPasswordReset } from '@/lib/server/password-reset-service'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { hashSecureToken } from '@/lib/server/secure-token'
import {
  createTenantUser,
  setTenantUserActive,
  updateTenantUser,
  UserConflictError,
} from '@/lib/server/user-service'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL tenant user management isolation', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantA = randomUUID()
  const tenantB = randomUUID()
  const adminUserId = randomUUID()
  const sharedUserId = randomUUID()
  const adminMembershipId = randomUUID()
  const sharedMembershipA = randomUUID()
  const sharedMembershipB = randomUUID()
  const adminRoleA = randomUUID()
  const requesterRoleA = randomUUID()
  const requesterRoleB = randomUUID()
  const sessionA = randomUUID()
  const sessionB = randomUUID()
  const sharedEmail = `shared-${sharedUserId}@test.invalid`
  const principal = tenantAdminPrincipal({
    tenantId: tenantA,
    userId: adminUserId,
    membershipId: adminMembershipId,
    userLimit: 2,
  })

  beforeAll(async () => {
    await pool.query(
      `insert into tenants (id, name, slug)
       values ($1, 'User isolation A', $2), ($3, 'User isolation B', $4)`,
      [tenantA, `user-isolation-a-${tenantA}`, tenantB, `user-isolation-b-${tenantB}`],
    )
    await pool.query(
      `insert into users (id, email, name, status, email_verified_at)
       values
         ($1, $2, 'Tenant Administrator', 'active', now()),
         ($3, $4, 'Shared User', 'active', now())`,
      [
        adminUserId,
        `admin-${adminUserId}@test.invalid`,
        sharedUserId,
        sharedEmail,
      ],
    )
    await pool.query(
      `insert into user_credentials (user_id, password_hash)
       values ($1, 'integration-hash'), ($2, 'integration-hash')`,
      [adminUserId, sharedUserId],
    )

    await tenantTransaction(pool, tenantA, async (client) => {
      await client.query(
        `insert into roles (id, tenant_id, role_key, name)
         values
           ($1, $3, 'tenant_admin', 'Tenant administrator'),
           ($2, $3, 'requester', 'Requester')`,
        [adminRoleA, requesterRoleA, tenantA],
      )
      await client.query(
        `insert into tenant_memberships (
           id, tenant_id, user_id, role_id, status, profile_key
         ) values
           ($1, $3, $4, $6, 'active', 'lider'),
           ($2, $3, $5, $7, 'active', 'operacional')`,
        [
          adminMembershipId,
          sharedMembershipA,
          tenantA,
          adminUserId,
          sharedUserId,
          adminRoleA,
          requesterRoleA,
        ],
      )
      await client.query(
        `insert into user_sessions (
           id, tenant_id, membership_id, user_id, token_hash, expires_at
         ) values ($1, $2, $3, $4, $5, now() + interval '1 hour')`,
        [sessionA, tenantA, sharedMembershipA, sharedUserId, 'a'.repeat(64)],
      )
    })

    await tenantTransaction(pool, tenantB, async (client) => {
      await client.query(
        `insert into roles (id, tenant_id, role_key, name)
         values ($1, $2, 'requester', 'Requester')`,
        [requesterRoleB, tenantB],
      )
      await client.query(
        `insert into tenant_memberships (
           id, tenant_id, user_id, role_id, status, profile_key
         ) values ($1, $2, $3, $4, 'active', 'operacional')`,
        [sharedMembershipB, tenantB, sharedUserId, requesterRoleB],
      )
      await client.query(
        `insert into user_sessions (
           id, tenant_id, membership_id, user_id, token_hash, expires_at
         ) values ($1, $2, $3, $4, $5, now() + interval '1 hour')`,
        [sessionB, tenantB, sharedMembershipB, sharedUserId, 'b'.repeat(64)],
      )
    })
  })

  afterAll(async () => {
    await closeDatabasePool()
    await tenantTransaction(pool, tenantA, async (client) => {
      await client.query(`select set_config('app.tenant_reset', 'on', true)`)
      await client.query(
        'delete from audit_logs where actor_user_id = any($1::uuid[])',
        [[adminUserId, sharedUserId]],
      )
    })
    await tenantTransaction(pool, tenantB, async (client) => {
      await client.query(`select set_config('app.tenant_reset', 'on', true)`)
      await client.query(
        'delete from audit_logs where actor_user_id = any($1::uuid[])',
        [[adminUserId, sharedUserId]],
      )
    })
    await pool.query('delete from tenants where id = any($1::uuid[])', [[tenantA, tenantB]])
    await pool.query('delete from users where id = any($1::uuid[])', [[adminUserId, sharedUserId]])
    await pool.end()
  })

  it('reconhece um vinculo existente no tenant mesmo com FORCE RLS', async () => {
    await expect(createTenantUser(principal, {
      email: sharedEmail,
      name: 'Shared User',
      role: 'colaborador',
      profile: 'operacional',
      password: 'BDEX-Test-Password!2026',
    })).rejects.toThrow('Este e-mail ja possui acesso ao tenant.')
  })

  it('aplica o limite de usuarios usando o contexto RLS do tenant', async () => {
    await expect(createTenantUser(principal, {
      email: `limit-${randomUUID()}@test.invalid`,
      name: 'Limit Candidate',
      role: 'colaborador',
      profile: 'operacional',
      password: 'BDEX-Test-Password!2026',
    })).rejects.toThrow('Limite de usuarios do plano atingido.')
  })

  it('impede que o administrador do tenant altere uma identidade compartilhada', async () => {
    await expect(updateTenantUser(principal, sharedUserId, {
      email: sharedEmail,
      name: 'Changed by tenant A',
      role: 'colaborador',
      profile: 'operacional',
      active: true,
    })).rejects.toMatchObject({
      code: 'SHARED_IDENTITY_MANAGEMENT_DENIED',
    })

    const identity = await pool.query<{ name: string }>(
      'select name from users where id = $1',
      [sharedUserId],
    )
    expect(identity.rows[0]?.name).toBe('Shared User')
  })

  it('desativa somente o vinculo e as sessoes do tenant solicitado', async () => {
    const result = await setTenantUserActive(principal, sharedUserId, false)
    expect(result.ativo).toBe(false)
    expect(result.status).toBe('inactive')

    const tenantAState = await tenantTransaction(pool, tenantA, async (client) => {
      const membership = await client.query<{ status: string }>(
        'select status from tenant_memberships where id = $1',
        [sharedMembershipA],
      )
      const session = await client.query<{ status: string }>(
        'select status from user_sessions where id = $1',
        [sessionA],
      )
      return {
        membership: membership.rows[0]?.status,
        session: session.rows[0]?.status,
      }
    })
    const tenantBState = await tenantTransaction(pool, tenantB, async (client) => {
      const membership = await client.query<{ status: string }>(
        'select status from tenant_memberships where id = $1',
        [sharedMembershipB],
      )
      const session = await client.query<{ status: string }>(
        'select status from user_sessions where id = $1',
        [sessionB],
      )
      return {
        membership: membership.rows[0]?.status,
        session: session.rows[0]?.status,
      }
    })
    const identity = await pool.query<{ status: string }>(
      'select status from users where id = $1',
      [sharedUserId],
    )

    expect(tenantAState).toEqual({ membership: 'inactive', session: 'revoked' })
    expect(tenantBState).toEqual({ membership: 'active', session: 'active' })
    expect(identity.rows[0]?.status).toBe('active')

    await setTenantUserActive(principal, sharedUserId, true)
  })

  it('redefine a senha e invalida MFA em todos os tenants da identidade', async () => {
    const rawToken = `reset-${randomUUID()}`
    const resetId = randomUUID()
    const mfaMethodA = randomUUID()
    const mfaMethodB = randomUUID()
    const challengeA = randomUUID()
    const challengeB = randomUUID()

    await tenantTransaction(pool, tenantA, async (client) => {
      await client.query(
        `insert into user_mfa_methods (
           id, tenant_id, membership_id, user_id, status,
           secret_ciphertext, secret_iv, secret_auth_tag, last_used_step, enabled_at
         ) values ($1, $2, $3, $4, 'enabled', 'cipher-a', 'iv-a', 'tag-a', 100, now())`,
        [mfaMethodA, tenantA, sharedMembershipA, sharedUserId],
      )
      await client.query(
        `insert into user_mfa_recovery_codes (
           tenant_id, mfa_method_id, membership_id, user_id, code_hash
         ) values ($1, $2, $3, $4, $5)`,
        [tenantA, mfaMethodA, sharedMembershipA, sharedUserId, 'c'.repeat(64)],
      )
      await client.query(
        `insert into auth_mfa_challenges (
           id, tenant_id, membership_id, user_id, token_hash, purpose,
           max_attempts, expires_at
         ) values ($1, $2, $3, $4, $5, 'login', 6, now() + interval '10 minutes')`,
        [challengeA, tenantA, sharedMembershipA, sharedUserId, 'd'.repeat(64)],
      )
    })

    await tenantTransaction(pool, tenantB, async (client) => {
      await client.query(
        `insert into user_mfa_methods (
           id, tenant_id, membership_id, user_id, status,
           secret_ciphertext, secret_iv, secret_auth_tag, last_used_step, enabled_at
         ) values ($1, $2, $3, $4, 'enabled', 'cipher-b', 'iv-b', 'tag-b', 200, now())`,
        [mfaMethodB, tenantB, sharedMembershipB, sharedUserId],
      )
      await client.query(
        `insert into user_mfa_recovery_codes (
           tenant_id, mfa_method_id, membership_id, user_id, code_hash
         ) values ($1, $2, $3, $4, $5)`,
        [tenantB, mfaMethodB, sharedMembershipB, sharedUserId, 'e'.repeat(64)],
      )
      await client.query(
        `insert into auth_mfa_challenges (
           id, tenant_id, membership_id, user_id, token_hash, purpose,
           max_attempts, expires_at
         ) values ($1, $2, $3, $4, $5, 'login', 6, now() + interval '10 minutes')`,
        [challengeB, tenantB, sharedMembershipB, sharedUserId, 'f'.repeat(64)],
      )
    })

    await pool.query(
      `insert into password_reset_tokens (
         id, tenant_id, user_id, token_hash, expires_at
       ) values ($1, $2, $3, $4, now() + interval '15 minutes')`,
      [resetId, tenantB, sharedUserId, hashSecureToken(rawToken, 'password-reset')],
    )

    await confirmPasswordReset(rawToken, 'BDEX-Reset-Password!2026', {
      requestId: randomUUID(),
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    })

    for (const tenantId of [tenantA, tenantB]) {
      const mfaState = await tenantTransaction(pool, tenantId, (client) => client.query<{
        disabled_methods: number
        available_recovery_codes: number
        pending_challenges: number
      }>(
        `select
           count(*) filter (
             where method.status = 'disabled'
               and method.disabled_at is not null
               and method.last_used_step is null
           )::int as disabled_methods,
           (
             select count(*)::int
             from user_mfa_recovery_codes recovery
             where recovery.tenant_id = $1 and recovery.user_id = $2 and recovery.used_at is null
           ) as available_recovery_codes,
           (
             select count(*)::int
             from auth_mfa_challenges challenge
             where challenge.tenant_id = $1 and challenge.user_id = $2 and challenge.status = 'pending'
           ) as pending_challenges
         from user_mfa_methods method
         where method.tenant_id = $1 and method.user_id = $2`,
        [tenantId, sharedUserId],
      ))
      expect(mfaState.rows[0]).toEqual({
        disabled_methods: 1,
        available_recovery_codes: 0,
        pending_challenges: 0,
      })
    }

    const audit = await tenantTransaction(pool, tenantB, (client) => client.query<{
      tenant_id: string
      entity_id: string
      metadata: {
        mfaMethodsDisabled: number
        mfaRecoveryCodesRevoked: number
        mfaChallengesExpired: number
      }
    }>(
      `select tenant_id, entity_id, metadata
         from audit_logs
        where action = 'auth.password_reset_completed'
          and entity_id = $1`,
      [resetId],
    ))
    expect(audit.rows).toEqual([{
      tenant_id: tenantB,
      entity_id: resetId,
      metadata: {
        mfaMethodsDisabled: 2,
        mfaRecoveryCodesRevoked: 2,
        mfaChallengesExpired: 2,
      },
    }])
  })
})

function tenantAdminPrincipal(args: {
  tenantId: string
  userId: string
  membershipId: string
  userLimit: number
}): RequestPrincipal {
  return {
    sessionId: '',
    tenantId: args.tenantId,
    tenantSlug: `tenant-${args.tenantId}`,
    tenantStatus: 'active',
    membershipId: args.membershipId,
    roleKey: 'tenant_admin',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: {
      users: args.userLimit,
      storageBytes: null,
      monthlyOperations: null,
    },
    user: {
      id: args.userId,
      email: `admin-${args.userId}@test.invalid`,
      name: 'Tenant Administrator',
      role: 'master',
      tenant_id: args.tenantId,
      tenant_slug: `tenant-${args.tenantId}`,
      membership_id: args.membershipId,
      role_key: 'tenant_admin',
      platform_admin: false,
      company_id: null,
      perfil_bbt: 'lider',
      permissoes: PERMISSOES_PADRAO_POR_PERFIL.lider,
      ativo: true,
    },
  }
}

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
