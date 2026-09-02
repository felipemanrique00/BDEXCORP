import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { closeDatabasePool } from '@/lib/server/database'
import { createSession } from '@/lib/server/auth-service'
import {
  beginMfaLogin,
  MfaError,
  startMfaEnrollment,
  stepUpMfaSession,
  verifyMfaChallenge,
} from '@/lib/server/mfa-service'
import { hashPassword } from '@/lib/security/password'
import { generateTotp } from '@/lib/security/totp'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import { testDatabaseUrl } from '../support/test-database'

const databaseUrl = testDatabaseUrl()
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('PostgreSQL administrative MFA', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 })
  const tenantId = randomUUID()
  const otherTenantId = randomUUID()
  const userId = randomUUID()
  const membershipId = randomUUID()
  const roleId = randomUUID()
  const planId = randomUUID()
  const planKey = `mfa-${randomUUID()}`
  const principal = principalFor(tenantId, userId, membershipId)
  let firstRecoveryCode = ''
  let secondRecoveryCode = ''
  let enrollmentSecret = ''
  let enrollmentTotpCode = ''
  let methodId = ''

  beforeAll(async () => {
    await pool.query(
      `insert into plans (id, plan_key, name, entitlements)
       values ($1, $2, 'MFA Integration Plan', '{}'::jsonb)`,
      [planId, planKey],
    )
    await pool.query(
      `insert into tenants (id, name, slug, status)
       values
         ($1, 'MFA Tenant', $2, 'active'),
         ($3, 'Other MFA Tenant', $4, 'active')`,
      [tenantId, `mfa-${tenantId}`, otherTenantId, `mfa-other-${otherTenantId}`],
    )
    await pool.query(
      `insert into users (id, email, name, status, email_verified_at)
       values ($1, $2, 'MFA Administrator', 'active', now())`,
      [userId, `mfa-${userId}@test.invalid`],
    )
    await pool.query(
      `insert into user_credentials (user_id, password_hash)
       values ($1, $2)`,
      [userId, await hashPassword('Mfa-Test#Password-2026')],
    )
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(
        `insert into tenant_subscriptions (tenant_id, plan_id, status, billing_mode)
         values ($1, $2, 'active', 'manual')`,
        [tenantId, planId],
      )
      await client.query(
        `insert into roles (id, tenant_id, role_key, name, system_role)
         values ($1, $2, 'tenant_admin', 'Tenant administrator', true)`,
        [roleId, tenantId],
      )
      await client.query(
        `insert into role_permissions (role_id, permission_key, allowed)
         select $1, permission_key, true from permissions`,
        [roleId],
      )
      await client.query(
        `insert into tenant_memberships (
           id, tenant_id, user_id, role_id, status, profile_key
         ) values ($1, $2, $3, $4, 'active', 'lider')`,
        [membershipId, tenantId, userId, roleId],
      )
    })
  })

  afterAll(async () => {
    await closeDatabasePool()
    await tenantTransaction(pool, tenantId, async (client) => {
      await client.query(`select set_config('app.tenant_reset', 'on', true)`)
      await client.query('delete from audit_logs where tenant_id = $1', [tenantId])
      await client.query('delete from tenant_subscriptions where tenant_id = $1', [tenantId])
      await client.query('delete from tenants where id = $1', [tenantId])
    })
    await pool.query('delete from tenants where id = $1', [otherTenantId])
    await pool.query('delete from users where id = $1', [userId])
    await pool.query('delete from plans where id = $1', [planId])
    await pool.end()
  })

  it('enrolls an administrator before creating a session identity', async () => {
    const requirement = await beginMfaLogin(principal)
    expect(requirement).toMatchObject({ required: true, mode: 'enroll' })
    if (!requirement.required) throw new Error('MFA enrollment was not required.')

    const enrollment = await startMfaEnrollment(requirement.challengeToken)
    expect(enrollment.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(enrollment.provisioningUri).toContain('otpauth://totp/')

    enrollmentSecret = enrollment.secret
    enrollmentTotpCode = generateTotp(enrollment.secret)
    const verification = await verifyMfaChallenge(requirement.challengeToken, enrollmentTotpCode)
    expect(verification.principal.user.id).toBe(userId)
    expect(verification.method).toBe('totp')
    expect(verification.recoveryCodes).toHaveLength(10)
    firstRecoveryCode = verification.recoveryCodes![0]
    secondRecoveryCode = verification.recoveryCodes![1]

    const method = await tenantTransaction(pool, tenantId, (client) => client.query(
      `select id, status, secret_ciphertext, last_used_step
       from user_mfa_methods
       where tenant_id = $1 and membership_id = $2`,
      [tenantId, membershipId],
    ))
    expect(method.rows[0]).toMatchObject({ status: 'enabled' })
    expect(method.rows[0].secret_ciphertext).not.toContain(enrollment.secret)
    expect(Number(method.rows[0].last_used_step)).toBeGreaterThan(0)
    methodId = method.rows[0].id
  })

  it('rejects TOTP replay and consumes a recovery code only once', async () => {
    const replayChallenge = await beginMfaLogin(principal)
    expect(replayChallenge).toMatchObject({ required: true, mode: 'verify' })
    if (!replayChallenge.required) throw new Error('MFA verification was not required.')

    await expect(verifyMfaChallenge(replayChallenge.challengeToken, enrollmentTotpCode))
      .rejects.toMatchObject({ code: 'MFA_CODE_INVALID' } satisfies Partial<MfaError>)

    const firstRecovery = await verifyMfaChallenge(replayChallenge.challengeToken, firstRecoveryCode)
    expect(firstRecovery.method).toBe('recovery_code')

    const reusedChallenge = await beginMfaLogin(principal)
    if (!reusedChallenge.required) throw new Error('MFA verification was not required.')
    await expect(verifyMfaChallenge(reusedChallenge.challengeToken, firstRecoveryCode))
      .rejects.toMatchObject({ code: 'MFA_CODE_INVALID' } satisfies Partial<MfaError>)

    const remaining = await tenantTransaction(pool, tenantId, (client) => client.query(
      `select count(*)::int as count
       from user_mfa_recovery_codes
       where tenant_id = $1 and mfa_method_id = $2 and used_at is null`,
      [tenantId, methodId],
    ))
    expect(remaining.rows[0].count).toBe(9)
  })

  it('steps up only the authenticated session and rejects TOTP and recovery-code replay', async () => {
    const totpSession = await createSession(principal, { userAgent: 'mfa-step-up-totp' })
    const untouchedSession = await createSession(principal, { userAgent: 'mfa-step-up-untouched' })
    const recoverySession = await createSession(principal, { userAgent: 'mfa-step-up-recovery' })
    const nextTotpCode = generateTotp(enrollmentSecret, { timestampMs: Date.now() + 30_000 })

    const totpResult = await stepUpMfaSession(totpSession.principal, nextTotpCode)
    expect(totpResult.method).toBe('totp')
    expect(totpResult.verifiedAt).toBeInstanceOf(Date)

    await expect(stepUpMfaSession(untouchedSession.principal, nextTotpCode))
      .rejects.toMatchObject({ code: 'MFA_CODE_INVALID' } satisfies Partial<MfaError>)

    const recoveryResult = await stepUpMfaSession(recoverySession.principal, secondRecoveryCode)
    expect(recoveryResult.method).toBe('recovery_code')

    await expect(stepUpMfaSession(untouchedSession.principal, secondRecoveryCode))
      .rejects.toMatchObject({ code: 'MFA_CODE_INVALID' } satisfies Partial<MfaError>)

    const sessions = await tenantTransaction(pool, tenantId, (client) => client.query<{
      id: string
      authentication_level: string
      mfa_verified_at: Date | null
      mfa_method: string | null
    }>(
      `select id, authentication_level, mfa_verified_at, mfa_method
       from user_sessions
       where tenant_id = $1 and id = any($2::uuid[])`,
      [tenantId, [totpSession.principal.sessionId, untouchedSession.principal.sessionId, recoverySession.principal.sessionId]],
    ))
    const sessionsById = new Map(sessions.rows.map((row) => [row.id, row]))
    expect(sessionsById.get(totpSession.principal.sessionId)).toMatchObject({
      authentication_level: 'mfa',
      mfa_method: 'totp',
    })
    expect(sessionsById.get(totpSession.principal.sessionId)?.mfa_verified_at).toBeInstanceOf(Date)
    expect(sessionsById.get(recoverySession.principal.sessionId)).toMatchObject({
      authentication_level: 'mfa',
      mfa_method: 'recovery_code',
    })
    expect(sessionsById.get(recoverySession.principal.sessionId)?.mfa_verified_at).toBeInstanceOf(Date)
    expect(sessionsById.get(untouchedSession.principal.sessionId)).toMatchObject({
      authentication_level: 'password',
      mfa_verified_at: null,
      mfa_method: null,
    })

    const audits = await tenantTransaction(pool, tenantId, (client) => client.query<{
      result: string
      entity_id: string | null
    }>(
      `select result, entity_id
       from audit_logs
       where tenant_id = $1 and action = 'auth.mfa.step_up'`,
      [tenantId],
    ))
    expect(audits.rows.filter((row) => row.result === 'success').map((row) => row.entity_id))
      .toEqual(expect.arrayContaining([totpSession.principal.sessionId, recoverySession.principal.sessionId]))
    expect(audits.rows.filter((row) => row.result === 'failure')).toHaveLength(2)
  })

  it('enforces tenant isolation and database identity constraints', async () => {
    const hidden = await tenantTransaction(pool, otherTenantId, (client) => client.query(
      'select id from user_mfa_methods where id = $1',
      [methodId],
    ))
    expect(hidden.rowCount).toBe(0)

    await expect(tenantTransaction(pool, tenantId, (client) => client.query(
      `insert into auth_mfa_challenges (
         tenant_id, membership_id, user_id, token_hash, purpose,
         max_attempts, expires_at
       ) values ($1, $2, $3, $4, 'login', 6, now() + interval '10 minutes')`,
      [tenantId, membershipId, randomUUID(), 'a'.repeat(64)],
    ))).rejects.toThrow(/Vinculo MFA nao pertence/)
  })
})

function principalFor(
  tenantId: string,
  userId: string,
  membershipId: string,
): RequestPrincipal {
  return {
    sessionId: '',
    tenantId,
    tenantSlug: `mfa-${tenantId}`,
    tenantStatus: 'active',
    membershipId,
    roleKey: 'tenant_admin',
    platformAdmin: false,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    user: {
      id: userId,
      email: `mfa-${userId}@test.invalid`,
      name: 'MFA Administrator',
      role: 'master',
      tenant_id: tenantId,
      tenant_slug: `mfa-${tenantId}`,
      membership_id: membershipId,
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
