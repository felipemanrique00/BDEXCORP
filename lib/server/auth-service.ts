import 'server-only'

import { createHmac, randomBytes } from 'node:crypto'

import { PERMISSOES_PADRAO_POR_PERFIL, type PerfilBBT, type Permissoes, type User, type UserRole } from '@/types'
import { hashPassword, verifyPassword } from '@/lib/security/password'
import { writeAuditEvent } from '@/lib/server/audit-log'
import { getServerEnvironment } from '@/lib/server/environment'
import { queryDatabase, withTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'

const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(32).toString('base64url'))
const ACTIVE_TENANT_STATUSES = new Set(['active', 'trial'])
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trial'])

interface AuthRow {
  user_id: string
  email: string
  name: string
  phone: string | null
  avatar_url: string | null
  user_status: string
  platform_admin: boolean
  created_at: Date
  password_hash: string
  must_change_password: boolean
  failed_attempts: number
  locked_until: Date | null
  membership_id: string
  membership_status: string
  tenant_id: string
  tenant_name: string
  tenant_slug: string
  tenant_status: string
  role_key: string
  profile_key: string | null
  company_id: string | null
  allowed_company_ids: string[] | null
  allowed_group_ids: string[] | null
  permissions: Record<string, unknown> | null
  plan_key: string | null
  subscription_status: string | null
  entitlements: Record<string, unknown> | null
  max_users: number | null
  max_storage_bytes: string | number | null
  max_monthly_operations: number | null
}

interface SessionRow extends AuthRow {
  session_id: string
  session_status: string
  expires_at: Date
}

export type AuthenticationFailure = 'invalid_credentials' | 'account_locked' | 'workspace_required' | 'account_inactive'

export interface AuthenticationResult {
  principal: RequestPrincipal | null
  failure?: AuthenticationFailure
}

export interface SessionCreationResult {
  token: string
  principal: RequestPrincipal
  expiresAt: Date
}

export interface RequestSecurityMetadata {
  ipAddress?: string | null
  userAgent?: string | null
  requestId?: string | null
}

export async function authenticateCredentials(
  emailInput: string,
  password: string,
  tenantSlug: string | null,
  metadata: RequestSecurityMetadata = {},
): Promise<AuthenticationResult> {
  const email = emailInput.trim().toLowerCase()
  const candidates = await loadAuthenticationCandidates(email, tenantSlug)

  if (!candidates.length) {
    await verifyPassword(password, await DUMMY_PASSWORD_HASH)
    await writeAuditEvent({
      action: 'auth.login',
      result: 'failure',
      tenantId: null,
      actorUserId: null,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: { reason: 'invalid_credentials' },
    })
    return { principal: null, failure: 'invalid_credentials' }
  }

  if (candidates.length > 1 && !tenantSlug) {
    const validPassword = await verifyPassword(password, candidates[0].password_hash)
    if (!validPassword) {
      await registerFailedLogin(candidates[0].user_id)
      await writeLoginAudit(candidates[0], 'failure', 'invalid_credentials', metadata)
      return { principal: null, failure: 'invalid_credentials' }
    }
    await writeLoginAudit(candidates[0], 'denied', 'workspace_required', metadata)
    return { principal: null, failure: 'workspace_required' }
  }

  const account = candidates[0]
  if (account.locked_until && account.locked_until.getTime() > Date.now()) {
    await writeLoginAudit(account, 'denied', 'account_locked', metadata)
    return { principal: null, failure: 'account_locked' }
  }

  const validPassword = await verifyPassword(password, account.password_hash)
  if (!validPassword) {
    await registerFailedLogin(account.user_id)
    await writeLoginAudit(account, 'failure', 'invalid_credentials', metadata)
    return { principal: null, failure: 'invalid_credentials' }
  }

  if (!isAccountActive(account)) {
    await writeLoginAudit(account, 'denied', 'account_inactive', metadata)
    return { principal: null, failure: 'account_inactive' }
  }

  await withTransaction(async (client) => {
    await client.query(
      'update user_credentials set failed_attempts = 0, locked_until = null where user_id = $1',
      [account.user_id],
    )
    await client.query('update users set last_login_at = now() where id = $1', [account.user_id])
  })
  await writeLoginAudit(account, 'success', null, metadata)
  return { principal: toPrincipal(account, '') }
}

export async function createSession(
  principal: RequestPrincipal,
  metadata: RequestSecurityMetadata = {},
): Promise<SessionCreationResult> {
  const environment = getServerEnvironment()
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + environment.AUTH_SESSION_HOURS * 60 * 60 * 1_000)
  const result = await queryDatabase<{ id: string }>(
    `insert into user_sessions (
       tenant_id, membership_id, user_id, token_hash, ip_address, user_agent, expires_at
     ) values ($1, $2, $3, $4, $5::inet, $6, $7) returning id`,
    [
      principal.tenantId,
      principal.membershipId,
      principal.user.id,
      hashOpaqueToken(token),
      normalizeIp(metadata.ipAddress),
      truncate(metadata.userAgent, 512),
      expiresAt,
    ],
  )
  const sessionId = result.rows[0].id
  return {
    token,
    principal: { ...principal, sessionId },
    expiresAt,
  }
}

export async function resolveSession(token: string | null | undefined): Promise<RequestPrincipal | null> {
  if (!token) return null
  const result = await queryDatabase<SessionRow>(`${principalSelect(true)}
    join user_sessions s on s.membership_id = m.id and s.user_id = u.id and s.tenant_id = t.id
    where s.token_hash = $1
    limit 1`, [hashOpaqueToken(token)])
  const row = result.rows[0]
  if (!row) return null

  if (row.session_status !== 'active' || row.expires_at.getTime() <= Date.now() || !isAccountActive(row)) {
    if (row.session_status === 'active' && row.expires_at.getTime() <= Date.now()) {
      await queryDatabase(
        `update user_sessions set status = 'expired', revoked_at = now(), revocation_reason = 'expired'
         where id = $1 and status = 'active'`,
        [row.session_id],
      )
    }
    return null
  }

  await queryDatabase(
    `update user_sessions set last_seen_at = now()
     where id = $1 and last_seen_at < now() - interval '5 minutes'`,
    [row.session_id],
  )
  return toPrincipal(row, row.session_id)
}

export async function revokeSession(token: string | null | undefined, reason = 'logout'): Promise<boolean> {
  if (!token) return false
  const result = await queryDatabase(
    `update user_sessions
     set status = 'revoked', revoked_at = now(), revocation_reason = $2
     where token_hash = $1 and status = 'active'`,
    [hashOpaqueToken(token), reason.slice(0, 120)],
  )
  return (result.rowCount || 0) > 0
}

export async function revokeUserSessions(userId: string, reason: string, exceptSessionId?: string): Promise<number> {
  const result = await queryDatabase(
    `update user_sessions
     set status = 'revoked', revoked_at = now(), revocation_reason = $2
     where user_id = $1 and status = 'active' and ($3::uuid is null or id <> $3::uuid)`,
    [userId, reason.slice(0, 120), exceptSessionId || null],
  )
  return result.rowCount || 0
}

export async function verifyUserPassword(userId: string, password: string): Promise<boolean> {
  const result = await queryDatabase<{ password_hash: string; locked_until: Date | null }>(
    'select password_hash, locked_until from user_credentials where user_id = $1',
    [userId],
  )
  const row = result.rows[0]
  if (!row || (row.locked_until && row.locked_until.getTime() > Date.now())) return false
  return verifyPassword(password, row.password_hash)
}

export async function replaceUserPassword(userId: string, newPassword: string, reason: string): Promise<void> {
  assertStrongPassword(newPassword)
  const passwordHash = await hashPassword(newPassword)
  await withTransaction(async (client) => {
    await client.query(
      `update user_credentials
       set password_hash = $2, password_updated_at = now(), must_change_password = false,
           failed_attempts = 0, locked_until = null
       where user_id = $1`,
      [userId, passwordHash],
    )
    await client.query(
      `update user_sessions
       set status = 'revoked', revoked_at = now(), revocation_reason = $2
       where user_id = $1 and status = 'active'`,
      [userId, reason.slice(0, 120)],
    )
  })
}

export function getSessionTokenFromRequest(request: Request): string | null {
  const cookieName = getServerEnvironment().AUTH_COOKIE_NAME
  const cookie = request.headers.get('cookie') || ''
  const encoded = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1)
  if (!encoded) return null
  try {
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}

export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return normalizeIp(request.headers.get('x-real-ip') || forwarded)
}

export function assertStrongPassword(password: string): void {
  if (
    password.length < 12 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new Error('A senha deve ter ao menos 12 caracteres, com maiuscula, minuscula, numero e simbolo.')
  }
}

function principalSelect(includeSession: boolean): string {
  const sessionColumns = includeSession
    ? ',\n    s.id as session_id,\n    s.status as session_status,\n    s.expires_at'
    : ''
  return `select
    u.id as user_id,
    u.email::text,
    u.name,
    u.phone,
    u.avatar_url,
    u.status as user_status,
    u.platform_admin,
    u.created_at,
    c.password_hash,
    c.must_change_password,
    c.failed_attempts,
    c.locked_until,
    m.id as membership_id,
    m.status as membership_status,
    m.profile_key,
    m.company_id,
    m.allowed_company_ids,
    m.allowed_group_ids,
    t.id as tenant_id,
    t.name as tenant_name,
    t.slug::text as tenant_slug,
    t.status as tenant_status,
    r.role_key,
    coalesce((
      select jsonb_object_agg(rp.permission_key, rp.allowed)
      from role_permissions rp
      where rp.role_id = r.id
    ), '{}'::jsonb) || m.custom_permissions as permissions,
    p.plan_key,
    ts.status as subscription_status,
    p.entitlements,
    p.max_users,
    p.max_storage_bytes,
    p.max_monthly_operations${sessionColumns}
  from users u
  join user_credentials c on c.user_id = u.id
  join tenant_memberships m on m.user_id = u.id
  join tenants t on t.id = m.tenant_id
  join roles r on r.id = m.role_id and (r.tenant_id = t.id or r.tenant_id is null)
  left join tenant_subscriptions ts on ts.tenant_id = t.id
  left join plans p on p.id = ts.plan_id`
}

async function loadAuthenticationCandidates(email: string, tenantSlug: string | null): Promise<AuthRow[]> {
  const result = await queryDatabase<AuthRow>(`${principalSelect(false)}
    where u.email = $1
      and ($2::text is null or t.slug = $2::citext)
    order by m.created_at asc
    limit 3`, [email, tenantSlug?.trim().toLowerCase() || null])
  return result.rows
}

function toPrincipal(row: AuthRow, sessionId: string): RequestPrincipal {
  const profile = normalizeProfile(row.profile_key, row.role_key)
  const permissions = normalizePermissions(row.permissions, profile)
  const role = normalizeUserRole(row.role_key)
  const user: User = {
    id: row.user_id,
    email: row.email,
    name: row.name,
    role,
    tenant_id: row.tenant_id,
    tenant_slug: row.tenant_slug,
    membership_id: row.membership_id,
    role_key: row.role_key,
    platform_admin: row.platform_admin,
    must_change_password: row.must_change_password,
    company_id: row.company_id,
    empresa_ids: row.allowed_company_ids || [],
    grupo_ids: row.allowed_group_ids || [],
    perfil_bbt: profile,
    permissoes: permissions,
    avatar: row.avatar_url || undefined,
    ativo: row.user_status === 'active' && row.membership_status === 'active',
    created_at: row.created_at.toISOString(),
  }

  return {
    sessionId,
    tenantId: row.tenant_id,
    tenantSlug: row.tenant_slug,
    tenantStatus: row.tenant_status,
    membershipId: row.membership_id,
    roleKey: row.role_key,
    platformAdmin: row.platform_admin,
    planKey: row.plan_key,
    entitlements: normalizeBooleanRecord(row.entitlements),
    limits: {
      users: row.max_users,
      storageBytes: row.max_storage_bytes === null ? null : Number(row.max_storage_bytes),
      monthlyOperations: row.max_monthly_operations,
    },
    user,
  }
}

function normalizePermissions(value: Record<string, unknown> | null, profile: PerfilBBT): Permissoes {
  const defaults = PERMISSOES_PADRAO_POR_PERFIL[profile]
  return Object.fromEntries(Object.keys(defaults).map((key) => [
    key,
    typeof value?.[key] === 'boolean' ? value[key] : defaults[key as keyof Permissoes],
  ])) as unknown as Permissoes
}

function normalizeBooleanRecord(value: Record<string, unknown> | null): Record<string, boolean> {
  if (!value) return {}
  return Object.fromEntries(Object.entries(value).map(([key, enabled]) => [key, enabled === true]))
}

function normalizeProfile(profile: string | null, roleKey: string): PerfilBBT {
  if (profile && Object.prototype.hasOwnProperty.call(PERMISSOES_PADRAO_POR_PERFIL, profile)) return profile as PerfilBBT
  if (roleKey === 'tenant_admin') return 'lider'
  if (roleKey === 'financial_manager') return 'gestor_financeiro'
  if (roleKey === 'supervisor') return 'supervisor'
  if (roleKey === 'agent') return 'agente'
  return 'operacional'
}

function normalizeUserRole(roleKey: string): UserRole {
  if (roleKey === 'company_admin') return 'company_admin'
  if (roleKey === 'requester' || roleKey === 'readonly') return 'colaborador'
  return 'master'
}

function isAccountActive(row: AuthRow): boolean {
  return row.user_status === 'active' &&
    row.membership_status === 'active' &&
    ACTIVE_TENANT_STATUSES.has(row.tenant_status) &&
    Boolean(row.plan_key) &&
    ACTIVE_SUBSCRIPTION_STATUSES.has(row.subscription_status || '')
}

async function registerFailedLogin(userId: string): Promise<void> {
  await queryDatabase(
    `update user_credentials set
       failed_attempts = failed_attempts + 1,
       locked_until = case
         when failed_attempts + 1 >= 10 then now() + interval '30 minutes'
         when failed_attempts + 1 >= 5 then now() + interval '5 minutes'
         else null
       end
     where user_id = $1`,
    [userId],
  )
}

async function writeLoginAudit(
  row: AuthRow,
  result: 'success' | 'denied' | 'failure',
  reason: string | null,
  metadata: RequestSecurityMetadata,
): Promise<void> {
  await writeAuditEvent({
    action: 'auth.login',
    result,
    tenantId: row.tenant_id,
    actorUserId: row.user_id,
    requestId: metadata.requestId,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
    metadata: reason ? { reason } : {},
  })
}

function hashOpaqueToken(token: string): string {
  const secret = getServerEnvironment().AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET obrigatorio para sessoes.')
  return createHmac('sha256', secret).update(token).digest('hex')
}

function normalizeIp(value: string | null | undefined): string | null {
  const candidate = value?.split(',')[0]?.trim()
  return candidate && /^[0-9a-f:.]+$/i.test(candidate) ? candidate : null
}

function truncate(value: string | null | undefined, max: number): string | null {
  return value ? value.slice(0, max) : null
}
