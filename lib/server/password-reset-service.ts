import 'server-only'

import { hashPassword } from '@/lib/security/password'
import { assertStrongPassword, type RequestSecurityMetadata } from '@/lib/server/auth-service'
import { writeAuditEvent } from '@/lib/server/audit-log'
import {
  applyDatabaseSecurityContext,
  queryDatabase,
  withDatabaseSecurityContext,
  withTransaction,
} from '@/lib/server/database'
import { sendTransactionalEmail } from '@/lib/server/email'
import { getServerEnvironment } from '@/lib/server/environment'
import { consumeRateLimit } from '@/lib/server/rate-limit'
import { createOpaqueToken, hashSecureToken } from '@/lib/server/secure-token'

interface ResetAccountRow {
  user_id: string
  email: string
  name: string
  tenant_id: string | null
}

export class InvalidPasswordResetTokenError extends Error {
  constructor() {
    super('Link de redefinicao invalido ou expirado.')
  }
}

export async function requestPasswordReset(
  emailInput: string,
  metadata: RequestSecurityMetadata,
): Promise<void> {
  const email = emailInput.trim().toLowerCase()
  const emailLimit = await consumeRateLimit(email, {
    key: 'password-reset:email',
    limit: 3,
    windowMs: 60 * 60 * 1_000,
  })
  if (!emailLimit.allowed) return

  const identityResult = await queryDatabase<Omit<ResetAccountRow, 'tenant_id'>>(
    `select id as user_id, email::text, name
       from users
      where email = $1 and status = 'active' and deleted_at is null
      limit 1`,
    [email],
  )
  const identity = identityResult.rows[0]
  if (!identity) return
  const tenantResult = await withDatabaseSecurityContext(
    { identityUserId: identity.user_id },
    (client) => client.query<{ tenant_id: string | null }>(
      `select min(m.tenant_id::text)::uuid as tenant_id
         from tenant_memberships m
         join tenants t on t.id = m.tenant_id and t.status in ('active', 'trial')
        where m.user_id = $1 and m.status = 'active'`,
      [identity.user_id],
    ),
  )
  const tenantId = tenantResult.rows[0]?.tenant_id || null
  if (!tenantId) return
  const account: ResetAccountRow = { ...identity, tenant_id: tenantId }

  const environment = getServerEnvironment()
  if (!environment.APP_URL) throw new Error('APP_URL obrigatorio para recuperacao de senha.')
  const token = createOpaqueToken()
  const tokenHash = hashSecureToken(token, 'password-reset')
  const expiresAt = new Date(Date.now() + environment.PASSWORD_RESET_MINUTES * 60_000)

  const tokenResult = await withTransaction(async (client) => {
    await client.query(
      'update password_reset_tokens set used_at = now() where user_id = $1 and used_at is null',
      [account.user_id],
    )
    return client.query<{ id: string }>(
      `insert into password_reset_tokens (tenant_id, user_id, token_hash, expires_at, requested_ip)
       values ($1, $2, $3, $4, $5::inet) returning id`,
      [account.tenant_id, account.user_id, tokenHash, expiresAt, normalizeIp(metadata.ipAddress)],
    )
  })
  const resetId = tokenResult.rows[0].id
  const resetUrl = new URL('/redefinir-senha', environment.APP_URL)
  resetUrl.searchParams.set('token', token)

  try {
    await sendTransactionalEmail({
      to: account.email,
      subject: 'Redefinicao de senha - BBT Corporativo',
      text: `Ola, ${account.name}. Use o link a seguir para redefinir sua senha: ${resetUrl.toString()}\n\nO link expira em ${environment.PASSWORD_RESET_MINUTES} minutos. Se voce nao solicitou, ignore esta mensagem.`,
      html: `<p>Ola, ${escapeHtml(account.name)}.</p><p>Use o link abaixo para redefinir sua senha:</p><p><a href="${escapeHtml(resetUrl.toString())}">Redefinir senha</a></p><p>O link expira em ${environment.PASSWORD_RESET_MINUTES} minutos. Se voce nao solicitou, ignore esta mensagem.</p>`,
    })
    await writeAuditEvent({
      action: 'auth.password_reset_requested',
      result: 'success',
      tenantId: account.tenant_id,
      actorUserId: account.user_id,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      entityType: 'password_reset',
      entityId: resetId,
    })
  } catch (error) {
    await queryDatabase('update password_reset_tokens set used_at = now() where id = $1', [resetId])
    await writeAuditEvent({
      action: 'auth.password_reset_requested',
      result: 'failure',
      tenantId: account.tenant_id,
      actorUserId: account.user_id,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      entityType: 'password_reset',
      entityId: resetId,
      metadata: { reason: 'email_delivery_failed' },
    })
    throw error
  }
}

export async function confirmPasswordReset(
  token: string,
  newPassword: string,
  metadata: RequestSecurityMetadata,
): Promise<void> {
  assertStrongPassword(newPassword)
  const passwordHash = await hashPassword(newPassword)
  const tokenHash = hashSecureToken(token, 'password-reset')

  const outcome = await withTransaction(async (client) => {
    const result = await client.query<{
      id: string
      user_id: string
      tenant_id: string | null
    }>(
      `select pr.id, pr.user_id, pr.tenant_id
         from password_reset_tokens pr
        where pr.token_hash = $1 and pr.used_at is null and pr.expires_at > now()
        for update of pr`,
      [tokenHash],
    )
    const reset = result.rows[0]
    if (!reset) throw new InvalidPasswordResetTokenError()
    await applyDatabaseSecurityContext(client, { identityUserId: reset.user_id })
    const tenant = reset.tenant_id
      ? { rows: [{ tenant_id: reset.tenant_id }] }
      : await client.query<{ tenant_id: string | null }>(
          `select min(m.tenant_id::text)::uuid as tenant_id
             from tenant_memberships m
             join tenants t on t.id = m.tenant_id and t.status in ('active', 'trial')
            where m.user_id = $1 and m.status = 'active'`,
          [reset.user_id],
        )

    await client.query(
      `update user_credentials set
         password_hash = $2, password_updated_at = now(), must_change_password = false,
         failed_attempts = 0, locked_until = null
       where user_id = $1`,
      [reset.user_id, passwordHash],
    )
    await client.query('update password_reset_tokens set used_at = now() where id = $1', [reset.id])
    await client.query(
      `update user_sessions set status = 'revoked', revoked_at = now(), revocation_reason = 'password_reset'
       where user_id = $1 and status = 'active'`,
      [reset.user_id],
    )

    const memberships = await client.query<{ tenant_id: string }>(
      `select distinct tenant_id
         from tenant_memberships
        where user_id = $1`,
      [reset.user_id],
    )
    const mfaReset = {
      mfaMethodsDisabled: 0,
      mfaRecoveryCodesRevoked: 0,
      mfaChallengesExpired: 0,
    }
    for (const membership of memberships.rows) {
      await applyDatabaseSecurityContext(client, {
        identityUserId: reset.user_id,
        tenantId: membership.tenant_id,
      })
      const methods = await client.query(
        `update user_mfa_methods
            set status = 'disabled',
                disabled_at = now(),
                last_used_step = null
          where tenant_id = $1
            and user_id = $2
            and status <> 'disabled'`,
        [membership.tenant_id, reset.user_id],
      )
      const recoveryCodes = await client.query(
        `delete from user_mfa_recovery_codes
          where tenant_id = $1
            and user_id = $2`,
        [membership.tenant_id, reset.user_id],
      )
      const challenges = await client.query(
        `update auth_mfa_challenges
            set status = 'expired'
          where tenant_id = $1
            and user_id = $2
            and status = 'pending'`,
        [membership.tenant_id, reset.user_id],
      )
      mfaReset.mfaMethodsDisabled += methods.rowCount ?? 0
      mfaReset.mfaRecoveryCodesRevoked += recoveryCodes.rowCount ?? 0
      mfaReset.mfaChallengesExpired += challenges.rowCount ?? 0
    }

    return {
      ...reset,
      tenant_id: tenant.rows[0]?.tenant_id || null,
      ...mfaReset,
    }
  })

  await writeAuditEvent({
    action: 'auth.password_reset_completed',
    result: 'success',
    tenantId: outcome.tenant_id,
    actorUserId: outcome.user_id,
    requestId: metadata.requestId,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
    entityType: 'password_reset',
    entityId: outcome.id,
    metadata: {
      mfaMethodsDisabled: outcome.mfaMethodsDisabled,
      mfaRecoveryCodesRevoked: outcome.mfaRecoveryCodesRevoked,
      mfaChallengesExpired: outcome.mfaChallengesExpired,
    },
  })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character)
}

function normalizeIp(value: string | null | undefined): string | null {
  const candidate = value?.split(',')[0]?.trim()
  return candidate && /^[0-9a-f:.]+$/i.test(candidate) ? candidate : null
}
