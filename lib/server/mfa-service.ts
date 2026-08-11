import 'server-only'

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto'
import type { PoolClient } from 'pg'

import {
  loadPrincipalForAuthenticatedUser,
  type RequestSecurityMetadata,
} from '@/lib/server/auth-service'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { withTenantTransaction } from '@/lib/server/database'
import { getServerEnvironment, isLocalMfaBypassEnabled } from '@/lib/server/environment'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  buildTotpUri,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  normalizeTotpCode,
  verifyTotp,
} from '@/lib/security/totp'
import { requiresAdministrativeMfa } from '@/lib/security/mfa-policy'

export { requiresAdministrativeMfa } from '@/lib/security/mfa-policy'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type MfaPurpose = 'login' | 'enrollment'
type MfaMethodUsed = 'totp' | 'recovery_code'

interface MfaMethodRow {
  id: string
  tenant_id: string
  membership_id: string
  user_id: string
  status: 'pending' | 'enabled' | 'disabled'
  secret_ciphertext: string
  secret_iv: string
  secret_auth_tag: string
  last_used_step: string | number | null
  enabled_at: Date | null
}

interface MfaChallengeRow {
  id: string
  tenant_id: string
  membership_id: string
  user_id: string
  purpose: MfaPurpose
  status: 'pending' | 'consumed' | 'expired' | 'locked'
  attempts: number
  max_attempts: number
  expires_at: Date
}

export type MfaLoginRequirement =
  | { required: false; bypassed?: 'explicit_local' }
  | {
      required: true
      mode: 'verify' | 'enroll'
      challengeToken: string
      expiresAt: Date
    }

export interface MfaEnrollmentDetails {
  secret: string
  provisioningUri: string
  expiresAt: Date
}

export interface MfaVerificationResult {
  principal: RequestPrincipal
  method: MfaMethodUsed
  verifiedAt: Date
  recoveryCodes?: string[]
}

export interface MfaStatus {
  required: boolean
  enabled: boolean
  enabledAt: Date | null
  remainingRecoveryCodes: number
}

export class MfaError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'MFA_CHALLENGE_INVALID'
      | 'MFA_CHALLENGE_EXPIRED'
      | 'MFA_CHALLENGE_LOCKED'
      | 'MFA_ENROLLMENT_NOT_STARTED'
      | 'MFA_CODE_INVALID'
      | 'MFA_NOT_ENABLED'
      | 'MFA_ACCOUNT_INACTIVE',
    readonly status = 400,
  ) {
    super(message)
    this.name = 'MfaError'
  }
}

export async function beginMfaLogin(
  principal: RequestPrincipal,
  metadata: RequestSecurityMetadata = {},
): Promise<MfaLoginRequirement> {
  const environment = getServerEnvironment()
  if (isLocalMfaBypassEnabled()) {
    return { required: false, bypassed: 'explicit_local' }
  }
  const enabled = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{ status: string }>(
      `select status
       from user_mfa_methods
       where tenant_id = $1 and membership_id = $2 and method = 'totp'
       limit 1`,
      [principal.tenantId, principal.membershipId],
    )
    return result.rows[0]?.status === 'enabled'
  })
  const mandatory = environment.MFA_ADMIN_REQUIRED && requiresAdministrativeMfa(principal)
  if (!enabled && !mandatory) return { required: false }

  const purpose: MfaPurpose = enabled ? 'login' : 'enrollment'
  const token = `${principal.tenantId}.${randomBytes(32).toString('base64url')}`
  const expiresAt = new Date(Date.now() + environment.MFA_CHALLENGE_MINUTES * 60_000)
  await withTenantTransaction(principal.tenantId, async (client) => {
    await client.query(
      `update auth_mfa_challenges
       set status = 'expired'
       where tenant_id = $1
         and membership_id = $2
         and status = 'pending'`,
      [principal.tenantId, principal.membershipId],
    )
    await client.query(
      `insert into auth_mfa_challenges (
         tenant_id, membership_id, user_id, token_hash, purpose,
         max_attempts, expires_at, ip_address, user_agent
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9)`,
      [
        principal.tenantId,
        principal.membershipId,
        principal.user.id,
        hashOpaqueMfaValue(token),
        purpose,
        environment.MFA_MAX_ATTEMPTS,
        expiresAt,
        normalizeIp(metadata.ipAddress),
        truncate(metadata.userAgent, 512),
      ],
    )
  })
  await writeAuditEvent({
    action: 'auth.mfa.challenge_issued',
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: principal.user.id,
    requestId: metadata.requestId,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
    metadata: { purpose },
  })
  return {
    required: true,
    mode: purpose === 'login' ? 'verify' : 'enroll',
    challengeToken: token,
    expiresAt,
  }
}

export async function startMfaEnrollment(
  challengeToken: string,
  metadata: RequestSecurityMetadata = {},
): Promise<MfaEnrollmentDetails> {
  const tenantId = tenantIdFromChallenge(challengeToken)
  const secret = generateTotpSecret()
  const encrypted = encryptSecret(secret)
  const result = await withTenantTransaction(tenantId, async (client) => {
    const challenge = await lockChallenge(client, tenantId, challengeToken)
    const challengeError = await validatePendingChallenge(client, challenge)
    if (challengeError || !challenge) {
      return {
        error: challengeError || new MfaError('Desafio de seguranca invalido.', 'MFA_CHALLENGE_INVALID', 401),
      } as const
    }
    if (challenge.purpose !== 'enrollment') {
      return {
        error: new MfaError('Este desafio nao permite configurar um novo autenticador.', 'MFA_CHALLENGE_INVALID'),
      } as const
    }

    const account = await client.query<{ email: string; tenant_name: string }>(
      `select u.email::text, t.name as tenant_name
       from users u
       join tenants t on t.id = $1
       where u.id = $2`,
      [tenantId, challenge.user_id],
    )
    if (!account.rows[0]) {
      return {
        error: new MfaError('A conta nao esta mais ativa.', 'MFA_ACCOUNT_INACTIVE', 401),
      } as const
    }

    const method = await client.query<{ id: string }>(
      `insert into user_mfa_methods (
         tenant_id, membership_id, user_id, method, status,
         secret_ciphertext, secret_iv, secret_auth_tag
       ) values ($1, $2, $3, 'totp', 'pending', $4, $5, $6)
       on conflict (tenant_id, membership_id, method) do update set
         status = 'pending',
         secret_ciphertext = excluded.secret_ciphertext,
         secret_iv = excluded.secret_iv,
         secret_auth_tag = excluded.secret_auth_tag,
         last_used_step = null,
         enabled_at = null,
         disabled_at = null
       where user_mfa_methods.status <> 'enabled'
       returning id`,
      [
        tenantId,
        challenge.membership_id,
        challenge.user_id,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
      ],
    )
    if (!method.rowCount) {
      return {
        error: new MfaError('O autenticador desta conta ja esta ativo.', 'MFA_CHALLENGE_INVALID', 409),
      } as const
    }
    await client.query(
      'delete from user_mfa_recovery_codes where tenant_id = $1 and mfa_method_id = $2',
      [tenantId, method.rows[0].id],
    )
    return {
      accountName: account.rows[0].email,
      tenantName: account.rows[0].tenant_name,
      expiresAt: challenge.expires_at,
      userId: challenge.user_id,
    } as const
  })

  if ('error' in result && result.error) {
    const failure = result.error
    await writeMfaFailure(failure, tenantId, null, metadata, 'auth.mfa.enrollment_started')
    throw failure
  }
  const issuer = getServerEnvironment().MFA_ISSUER
  await writeAuditEvent({
    action: 'auth.mfa.enrollment_started',
    result: 'success',
    tenantId,
    actorUserId: result.userId,
    requestId: metadata.requestId,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
  })
  return {
    secret,
    provisioningUri: buildTotpUri({
      issuer: `${issuer} - ${result.tenantName}`,
      accountName: result.accountName,
      secret,
    }),
    expiresAt: result.expiresAt,
  }
}

export async function verifyMfaChallenge(
  challengeToken: string,
  codeInput: string,
  metadata: RequestSecurityMetadata = {},
): Promise<MfaVerificationResult> {
  const tenantId = tenantIdFromChallenge(challengeToken)
  const verifiedAt = new Date()
  const transactionResult = await withTenantTransaction(tenantId, async (client) => {
    const challenge = await lockChallenge(client, tenantId, challengeToken)
    const challengeError = await validatePendingChallenge(client, challenge)
    if (challengeError || !challenge) {
      return {
        error: challengeError || new MfaError('Desafio de seguranca invalido.', 'MFA_CHALLENGE_INVALID', 401),
        userId: challenge?.user_id || null,
      } as const
    }

    const methodResult = await client.query<MfaMethodRow>(
      `select *
       from user_mfa_methods
       where tenant_id = $1
         and membership_id = $2
         and method = 'totp'
       for update`,
      [tenantId, challenge.membership_id],
    )
    const method = methodResult.rows[0]
    if (!method || (challenge.purpose === 'enrollment' && method.status !== 'pending')) {
      return {
        error: new MfaError('Inicie a configuracao do autenticador novamente.', 'MFA_ENROLLMENT_NOT_STARTED', 409),
        userId: challenge.user_id,
      } as const
    }
    if (challenge.purpose === 'login' && method.status !== 'enabled') {
      return {
        error: new MfaError('O autenticador nao esta ativo.', 'MFA_CHALLENGE_INVALID', 409),
        userId: challenge.user_id,
      } as const
    }

    const verification = await verifyCode(client, method, codeInput, challenge.purpose)
    if (!verification.ok) {
      const error = await recordFailedAttempt(client, challenge)
      return { error, userId: challenge.user_id } as const
    }

    let recoveryCodes: string[] | undefined
    if (challenge.purpose === 'enrollment') {
      recoveryCodes = generateRecoveryCodes()
      await client.query(
        `update user_mfa_methods
         set status = 'enabled',
             enabled_at = $3,
             disabled_at = null,
             last_used_step = $4
         where tenant_id = $1 and id = $2`,
        [tenantId, method.id, verifiedAt, verification.step],
      )
      await replaceRecoveryCodes(client, method, recoveryCodes)
    } else if (verification.method === 'totp') {
      await client.query(
        `update user_mfa_methods
         set last_used_step = $3
         where tenant_id = $1 and id = $2`,
        [tenantId, method.id, verification.step],
      )
    } else {
      await client.query(
        `update user_mfa_recovery_codes
         set used_at = $3
         where tenant_id = $1 and id = $2 and used_at is null`,
        [tenantId, verification.recoveryCodeId, verifiedAt],
      )
    }

    await client.query(
      `update auth_mfa_challenges
       set status = 'consumed', verified_at = $3
       where tenant_id = $1 and id = $2`,
      [tenantId, challenge.id, verifiedAt],
    )
    return {
      userId: challenge.user_id,
      membershipId: challenge.membership_id,
      method: verification.method,
      recoveryCodes,
    } as const
  })

  if ('error' in transactionResult && transactionResult.error) {
    const failure = transactionResult.error
    await writeMfaFailure(
      failure,
      tenantId,
      transactionResult.userId,
      metadata,
      'auth.mfa.verify',
    )
    throw failure
  }

  const principal = await loadPrincipalForAuthenticatedUser(
    transactionResult.userId,
    tenantId,
    transactionResult.membershipId,
  )
  if (!principal) {
    const error = new MfaError('A conta nao esta mais ativa.', 'MFA_ACCOUNT_INACTIVE', 401)
    await writeMfaFailure(error, tenantId, transactionResult.userId, metadata, 'auth.mfa.verify')
    throw error
  }
  await writeAuditEvent({
    action: 'auth.mfa.verify',
    result: 'success',
    tenantId,
    actorUserId: principal.user.id,
    requestId: metadata.requestId,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
    metadata: {
      method: transactionResult.method,
      enrollment: Boolean(transactionResult.recoveryCodes),
    },
  })
  return {
    principal,
    method: transactionResult.method,
    verifiedAt,
    recoveryCodes: transactionResult.recoveryCodes,
  }
}

export async function getMfaStatus(principal: RequestPrincipal): Promise<MfaStatus> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{
      status: string
      enabled_at: Date | null
      recovery_codes: string | number
    }>(
      `select
         m.status,
         m.enabled_at,
         count(rc.id) filter (where rc.used_at is null) as recovery_codes
       from user_mfa_methods m
       left join user_mfa_recovery_codes rc
         on rc.tenant_id = m.tenant_id and rc.mfa_method_id = m.id
       where m.tenant_id = $1 and m.membership_id = $2 and m.method = 'totp'
       group by m.id`,
      [principal.tenantId, principal.membershipId],
    )
    const row = result.rows[0]
    return {
      required: !isLocalMfaBypassEnabled() &&
        getServerEnvironment().MFA_ADMIN_REQUIRED &&
        requiresAdministrativeMfa(principal),
      enabled: row?.status === 'enabled',
      enabledAt: row?.enabled_at || null,
      remainingRecoveryCodes: Number(row?.recovery_codes || 0),
    }
  })
}

export async function regenerateMfaRecoveryCodes(
  principal: RequestPrincipal,
  codeInput: string,
  metadata: RequestSecurityMetadata = {},
): Promise<string[]> {
  const result = await withTenantTransaction(principal.tenantId, async (client) => {
    const methodResult = await client.query<MfaMethodRow>(
      `select *
       from user_mfa_methods
       where tenant_id = $1
         and membership_id = $2
         and method = 'totp'
       for update`,
      [principal.tenantId, principal.membershipId],
    )
    const method = methodResult.rows[0]
    if (!method || method.status !== 'enabled') {
      return {
        error: new MfaError('O autenticador ainda nao esta ativo.', 'MFA_NOT_ENABLED', 409),
      } as const
    }
    const verification = await verifyCode(client, method, codeInput, 'login')
    if (!verification.ok) {
      return {
        error: new MfaError('Codigo de verificacao invalido.', 'MFA_CODE_INVALID', 401),
      } as const
    }
    if (verification.method === 'totp') {
      await client.query(
        `update user_mfa_methods
         set last_used_step = $3
         where tenant_id = $1 and id = $2`,
        [principal.tenantId, method.id, verification.step],
      )
    }
    const recoveryCodes = generateRecoveryCodes()
    await replaceRecoveryCodes(client, method, recoveryCodes)
    return { recoveryCodes, method: verification.method } as const
  })
  if ('error' in result && result.error) {
    const failure = result.error
    await writeMfaFailure(
      failure,
      principal.tenantId,
      principal.user.id,
      metadata,
      'auth.mfa.recovery_codes_regenerated',
    )
    throw failure
  }
  await writeAuditEvent({
    action: 'auth.mfa.recovery_codes_regenerated',
    result: 'success',
    tenantId: principal.tenantId,
    actorUserId: principal.user.id,
    requestId: metadata.requestId,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
    metadata: { verificationMethod: result.method },
  })
  return result.recoveryCodes
}

async function lockChallenge(
  client: PoolClient,
  tenantId: string,
  challengeToken: string,
): Promise<MfaChallengeRow | null> {
  const result = await client.query<MfaChallengeRow>(
    `select *
     from auth_mfa_challenges
     where tenant_id = $1 and token_hash = $2
     for update`,
    [tenantId, hashOpaqueMfaValue(challengeToken)],
  )
  return result.rows[0] || null
}

async function validatePendingChallenge(
  client: PoolClient,
  challenge: MfaChallengeRow | null,
): Promise<MfaError | null> {
  if (!challenge) return new MfaError('Desafio de seguranca invalido.', 'MFA_CHALLENGE_INVALID', 401)
  if (challenge.status === 'locked' || challenge.attempts >= challenge.max_attempts) {
    return new MfaError('Desafio bloqueado por excesso de tentativas.', 'MFA_CHALLENGE_LOCKED', 429)
  }
  if (challenge.status !== 'pending') {
    return new MfaError('Desafio de seguranca invalido.', 'MFA_CHALLENGE_INVALID', 401)
  }
  if (challenge.expires_at.getTime() <= Date.now()) {
    await client.query(
      `update auth_mfa_challenges
       set status = 'expired'
       where tenant_id = $1 and id = $2`,
      [challenge.tenant_id, challenge.id],
    )
    return new MfaError('O desafio expirou. Entre novamente.', 'MFA_CHALLENGE_EXPIRED', 401)
  }
  return null
}

async function verifyCode(
  client: PoolClient,
  method: MfaMethodRow,
  codeInput: string,
  purpose: MfaPurpose,
): Promise<
  | { ok: true; method: 'totp'; step: number }
  | { ok: true; method: 'recovery_code'; recoveryCodeId: string; step: null }
  | { ok: false }
> {
  const totpCode = normalizeTotpCode(codeInput)
  if (/^\d{6}$/.test(totpCode)) {
    const secret = decryptSecret(method)
    const step = verifyTotp(secret, totpCode, { window: 1 })
    const lastUsedStep = method.last_used_step === null ? null : Number(method.last_used_step)
    if (step === null || (lastUsedStep !== null && step <= lastUsedStep)) return { ok: false }
    return { ok: true, method: 'totp', step }
  }
  if (purpose === 'enrollment') return { ok: false }

  const recoveryCode = normalizeRecoveryCode(codeInput)
  if (recoveryCode.length !== 16) return { ok: false }
  const result = await client.query<{ id: string }>(
    `select id
     from user_mfa_recovery_codes
     where tenant_id = $1
       and mfa_method_id = $2
       and code_hash = $3
       and used_at is null
     for update`,
    [method.tenant_id, method.id, hashRecoveryCode(recoveryCode)],
  )
  const row = result.rows[0]
  return row
    ? { ok: true, method: 'recovery_code', recoveryCodeId: row.id, step: null }
    : { ok: false }
}

async function recordFailedAttempt(
  client: PoolClient,
  challenge: MfaChallengeRow,
): Promise<MfaError> {
  const nextAttempts = Math.min(challenge.attempts + 1, challenge.max_attempts)
  const locked = nextAttempts >= challenge.max_attempts
  await client.query(
    `update auth_mfa_challenges
     set attempts = $3,
         status = case when $4 then 'locked' else status end
     where tenant_id = $1 and id = $2`,
    [challenge.tenant_id, challenge.id, nextAttempts, locked],
  )
  return locked
    ? new MfaError('Desafio bloqueado por excesso de tentativas.', 'MFA_CHALLENGE_LOCKED', 429)
    : new MfaError('Codigo de verificacao invalido.', 'MFA_CODE_INVALID', 401)
}

async function replaceRecoveryCodes(
  client: PoolClient,
  method: MfaMethodRow,
  recoveryCodes: string[],
): Promise<void> {
  await client.query(
    'delete from user_mfa_recovery_codes where tenant_id = $1 and mfa_method_id = $2',
    [method.tenant_id, method.id],
  )
  for (const code of recoveryCodes) {
    await client.query(
      `insert into user_mfa_recovery_codes (
         tenant_id, mfa_method_id, membership_id, user_id, code_hash
       ) values ($1, $2, $3, $4, $5)`,
      [
        method.tenant_id,
        method.id,
        method.membership_id,
        method.user_id,
        hashRecoveryCode(code),
      ],
    )
  }
}

function tenantIdFromChallenge(challengeToken: string): string {
  const tenantId = challengeToken.split('.', 1)[0]
  if (!UUID_PATTERN.test(tenantId)) {
    throw new MfaError('Desafio de seguranca invalido.', 'MFA_CHALLENGE_INVALID', 401)
  }
  return tenantId
}

function encryptSecret(secret: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', mfaEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  }
}

function decryptSecret(method: MfaMethodRow): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    mfaEncryptionKey(),
    Buffer.from(method.secret_iv, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(method.secret_auth_tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(method.secret_ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

function mfaEncryptionKey(): Buffer {
  const environment = getServerEnvironment()
  if (environment.MFA_ENCRYPTION_KEY) {
    const normalized = environment.MFA_ENCRYPTION_KEY.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(normalized, 'base64')
    if (decoded.length !== 32) throw new Error('MFA_ENCRYPTION_KEY deve conter exatamente 32 bytes.')
    return decoded
  }
  if (!environment.AUTH_SECRET) throw new Error('AUTH_SECRET obrigatorio para MFA.')
  return createHash('sha256').update(`bbt-mfa-development:${environment.AUTH_SECRET}`).digest()
}

function hashOpaqueMfaValue(value: string): string {
  return createHmac('sha256', mfaEncryptionKey()).update(value).digest('hex')
}

function hashRecoveryCode(value: string): string {
  return createHmac('sha256', mfaEncryptionKey())
    .update(`recovery:${normalizeRecoveryCode(value)}`)
    .digest('hex')
}

async function writeMfaFailure(
  error: MfaError,
  tenantId: string,
  userId: string | null,
  metadata: RequestSecurityMetadata,
  action: string,
): Promise<void> {
  await writeAuditEvent({
    action,
    result: error.code === 'MFA_CODE_INVALID' ? 'failure' : 'denied',
    tenantId,
    actorUserId: userId,
    requestId: metadata.requestId,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
    metadata: { reason: error.code },
  })
}

function normalizeIp(value: string | null | undefined): string | null {
  const candidate = value?.split(',')[0]?.trim()
  return candidate && /^[0-9a-f:.]+$/i.test(candidate) ? candidate : null
}

function truncate(value: string | null | undefined, max: number): string | null {
  return value ? value.slice(0, max) : null
}
