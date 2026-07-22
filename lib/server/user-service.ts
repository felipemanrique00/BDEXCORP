import 'server-only'

import { randomUUID } from 'node:crypto'

import { hashPassword } from '@/lib/security/password'
import { assertStrongPassword, revokeUserSessions } from '@/lib/server/auth-service'
import { queryDatabase, withTransaction } from '@/lib/server/database'
import { emailConfigured, sendTransactionalEmail } from '@/lib/server/email'
import { getServerEnvironment } from '@/lib/server/environment'
import { logError } from '@/lib/server/logger'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { createOpaqueToken, hashSecureToken } from '@/lib/server/secure-token'
import {
  PERMISSOES_PADRAO_POR_PERFIL,
  type PerfilBBT,
  type Permissoes,
  type User,
  type UserRole,
} from '@/types'

interface MembershipUserRow {
  id: string
  email: string
  name: string
  avatar_url: string | null
  status: string
  platform_admin: boolean
  must_change_password: boolean
  created_at: Date
  membership_id: string
  membership_status: string
  company_id: string | null
  allowed_company_ids: string[] | null
  allowed_group_ids: string[] | null
  profile_key: string | null
  role_key: string
  permissions: Record<string, unknown> | null
}

export interface UserMutationInput {
  email: string
  name: string
  password?: string
  role: UserRole
  profile?: PerfilBBT
  permissions?: Partial<Permissoes>
  companyId?: string | null
  companyIds?: string[]
  groupIds?: string[]
  avatar?: string | null
  active?: boolean
}

export async function listTenantUsers(principal: RequestPrincipal): Promise<User[]> {
  const result = await queryDatabase<MembershipUserRow>(`${userSelect()}
    where m.tenant_id = $1 and u.deleted_at is null
    order by u.name asc`, [principal.tenantId])
  return result.rows.map((row) => rowToUser(row, principal))
}

export async function listTenantDirectory(principal: RequestPrincipal): Promise<User[]> {
  const users = await listTenantUsers(principal)
  return users
    .filter((user) => user.ativo !== false)
    .map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenant_id: user.tenant_id,
      membership_id: user.membership_id,
      role_key: user.role_key,
      platform_admin: user.platform_admin,
      must_change_password: user.must_change_password,
      company_id: user.company_id,
      empresa_ids: user.empresa_ids,
      grupo_ids: user.grupo_ids,
      perfil_bbt: user.perfil_bbt,
      permissoes: user.permissoes,
      avatar: user.avatar,
      ativo: user.ativo,
      created_at: user.created_at,
    }))
}

export async function createTenantUser(
  principal: RequestPrincipal,
  input: UserMutationInput,
): Promise<User> {
  const invited = !input.password
  if (input.password) assertStrongPassword(input.password)
  if (invited && !emailConfigured()) {
    throw new UserInvitationUnavailableError('SMTP deve estar configurado para enviar convites.')
  }
  await enforceUserLimit(principal)

  const email = input.email.trim().toLowerCase()
  const name = input.name.trim()
  const roleKey = roleKeyFrom(input.role, input.profile)
  const passwordHash = await hashPassword(input.password || createOpaqueToken(48))
  const userId = randomUUID()
  const membershipId = randomUUID()
  const inviteToken = invited ? createOpaqueToken() : null
  const inviteHash = inviteToken ? hashSecureToken(inviteToken, 'user-invite') : null

  await withTransaction(async (client) => {
    const duplicate = await client.query(
      'select 1 from users where email = $1 and deleted_at is null',
      [email],
    )
    if (duplicate.rowCount) throw new UserConflictError('Ja existe usuario com este e-mail.')

    const role = await client.query(
      'select id from roles where tenant_id = $1 and role_key = $2',
      [principal.tenantId, roleKey],
    )
    if (!role.rowCount) throw new Error('Perfil de acesso nao configurado para o tenant.')

    await client.query(
      `insert into users (id, email, name, avatar_url, status, email_verified_at)
       values ($1, $2, $3, $4, $5, case when $5 = 'invited' then null else now() end)`,
      [userId, email, name, input.avatar || null, invited ? 'invited' : input.active === false ? 'inactive' : 'active'],
    )
    await client.query(
      `insert into user_credentials (user_id, password_hash, must_change_password)
       values ($1, $2, true)`,
      [userId, passwordHash],
    )
    await client.query(
      `insert into tenant_memberships (
         id, tenant_id, user_id, role_id, status, profile_key, custom_permissions,
         company_id, allowed_company_ids, allowed_group_ids
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::text[], $10::text[])`,
      [
        membershipId,
        principal.tenantId,
        userId,
        role.rows[0].id,
        invited ? 'invited' : input.active === false ? 'inactive' : 'active',
        input.profile || profileFromRoleKey(roleKey),
        JSON.stringify(normalizePermissionPatch(input.permissions)),
        input.companyId || null,
        uniqueStrings(input.companyIds || []),
        uniqueStrings(input.groupIds || []),
      ],
    )
    if (inviteHash) {
      await client.query(
        `insert into user_invites (tenant_id, user_id, membership_id, token_hash, expires_at, created_by)
         values ($1, $2, $3, $4, now() + interval '72 hours', $5)`,
        [principal.tenantId, userId, membershipId, inviteHash, principal.user.id],
      )
    }
  })

  if (inviteToken) {
    try {
      await sendUserInvitationEmail({ email, name, token: inviteToken })
    } catch (error) {
      await cleanupFailedInvitation(principal.tenantId, userId)
      logError('tenant_user_invite_delivery_failed', error, {
        errorCode: 'TENANT_USER_INVITE_DELIVERY_FAILED',
        tenantId: principal.tenantId,
        userId,
      })
      throw new UserInvitationUnavailableError('Nao foi possivel entregar o convite. Verifique o SMTP e tente novamente.')
    }
  }

  const created = await getTenantUser(principal, userId)
  if (!created) throw new Error('Usuario criado, mas nao foi possivel recarregar o cadastro.')
  return created
}

export async function resendTenantUserInvite(
  principal: RequestPrincipal,
  userId: string,
): Promise<void> {
  if (!emailConfigured()) {
    throw new UserInvitationUnavailableError('SMTP deve estar configurado para reenviar convites.')
  }
  const user = await getTenantUser(principal, userId)
  if (!user) throw new UserNotFoundError()
  if (user.status !== 'invited') throw new UserConflictError('Somente convites pendentes podem ser reenviados.')

  const inviteId = randomUUID()
  const inviteToken = createOpaqueToken()
  const inviteHash = hashSecureToken(inviteToken, 'user-invite')
  await withTransaction(async (client) => {
    const membership = await client.query<{ id: string }>(
      `select id from tenant_memberships
       where tenant_id = $1 and user_id = $2 and status = 'invited'
       for update`,
      [principal.tenantId, userId],
    )
    if (!membership.rowCount) throw new UserConflictError('Convite pendente nao encontrado.')
    await client.query(
      `insert into user_invites (id, tenant_id, user_id, membership_id, token_hash, expires_at, created_by)
       values ($1, $2, $3, $4, $5, now() + interval '72 hours', $6)`,
      [inviteId, principal.tenantId, userId, membership.rows[0].id, inviteHash, principal.user.id],
    )
  })

  try {
    await sendUserInvitationEmail({ email: user.email, name: user.name, token: inviteToken })
    await queryDatabase(
      `update user_invites set expires_at = now()
       where tenant_id = $1 and user_id = $2 and accepted_at is null and id <> $3`,
      [principal.tenantId, userId, inviteId],
    )
  } catch (error) {
    await queryDatabase(
      'delete from user_invites where id = $1 and tenant_id = $2 and accepted_at is null',
      [inviteId, principal.tenantId],
    ).catch((cleanupError) => {
      logError('tenant_user_invite_retry_cleanup_failed', cleanupError, {
        errorCode: 'TENANT_USER_INVITE_RETRY_CLEANUP_FAILED',
        tenantId: principal.tenantId,
        userId,
      })
    })
    logError('tenant_user_invite_retry_delivery_failed', error, {
      errorCode: 'TENANT_USER_INVITE_RETRY_DELIVERY_FAILED',
      tenantId: principal.tenantId,
      userId,
    })
    throw new UserInvitationUnavailableError('Nao foi possivel reenviar o convite. Verifique o SMTP e tente novamente.')
  }
}

export async function updateTenantUser(
  principal: RequestPrincipal,
  userId: string,
  input: UserMutationInput,
): Promise<User> {
  const current = await getTenantUser(principal, userId)
  if (!current) throw new UserNotFoundError()
  if (current.platform_admin && userId !== principal.user.id) {
    throw new UserConflictError('Administrador da plataforma nao pode ser alterado por outro usuario do tenant.')
  }
  if (input.password) assertStrongPassword(input.password)

  const roleKey = roleKeyFrom(input.role, input.profile)
  const nextStatus = current.status === 'invited'
    ? input.password ? 'active' : 'invited'
    : input.active === false ? 'inactive' : 'active'
  await withTransaction(async (client) => {
    const duplicate = await client.query(
      'select 1 from users where email = $1 and id <> $2 and deleted_at is null',
      [input.email.trim().toLowerCase(), userId],
    )
    if (duplicate.rowCount) throw new UserConflictError('Ja existe usuario com este e-mail.')

    const role = await client.query(
      'select id from roles where tenant_id = $1 and role_key = $2',
      [principal.tenantId, roleKey],
    )
    if (!role.rowCount) throw new Error('Perfil de acesso nao configurado para o tenant.')

    await client.query(
      `update users set email = $2, name = $3, avatar_url = $4, status = $5
       where id = $1`,
      [userId, input.email.trim().toLowerCase(), input.name.trim(), input.avatar || null, nextStatus],
    )
    await client.query(
      `update tenant_memberships set
         role_id = $3,
         status = $4,
         profile_key = $5,
         custom_permissions = $6::jsonb,
         company_id = $7,
         allowed_company_ids = $8::text[],
         allowed_group_ids = $9::text[]
       where tenant_id = $1 and user_id = $2`,
      [
        principal.tenantId,
        userId,
        role.rows[0].id,
        nextStatus,
        input.profile || profileFromRoleKey(roleKey),
        JSON.stringify(normalizePermissionPatch(input.permissions)),
        input.companyId || null,
        uniqueStrings(input.companyIds || []),
        uniqueStrings(input.groupIds || []),
      ],
    )
    if (input.password) {
      await client.query(
        `update user_credentials set
           password_hash = $2, password_updated_at = now(), must_change_password = true,
           failed_attempts = 0, locked_until = null
         where user_id = $1`,
        [userId, await hashPassword(input.password)],
      )
    }
  })

  if (input.password || input.active === false) await revokeUserSessions(userId, input.password ? 'password_changed_by_admin' : 'user_deactivated')
  const updated = await getTenantUser(principal, userId)
  if (!updated) throw new Error('Usuario alterado, mas nao foi possivel recarregar o cadastro.')
  return updated
}

export async function setTenantUserActive(
  principal: RequestPrincipal,
  userId: string,
  active: boolean,
): Promise<User> {
  if (userId === principal.user.id && !active) throw new UserConflictError('Voce nao pode desativar o proprio acesso.')
  const existing = await getTenantUser(principal, userId)
  if (!existing) throw new UserNotFoundError()
  if (existing.platform_admin) throw new UserConflictError('Administrador da plataforma nao pode ser desativado por esta operacao.')
  if (active && existing.status === 'invited') {
    throw new UserConflictError('Convite pendente. O usuario deve aceitar o convite ou receber uma senha temporaria antes da ativacao.')
  }

  await withTransaction(async (client) => {
    await client.query('update users set status = $2 where id = $1', [userId, active ? 'active' : 'inactive'])
    await client.query(
      'update tenant_memberships set status = $3 where tenant_id = $1 and user_id = $2',
      [principal.tenantId, userId, active ? 'active' : 'inactive'],
    )
  })
  if (!active) await revokeUserSessions(userId, 'user_deactivated')
  const updated = await getTenantUser(principal, userId)
  if (!updated) throw new Error('Usuario alterado, mas nao foi possivel recarregar o cadastro.')
  return updated
}

export async function getTenantUser(principal: RequestPrincipal, userId: string): Promise<User | null> {
  const result = await queryDatabase<MembershipUserRow>(`${userSelect()}
    where m.tenant_id = $1 and u.id = $2 and u.deleted_at is null
    limit 1`, [principal.tenantId, userId])
  return result.rows[0] ? rowToUser(result.rows[0], principal) : null
}

export class UserConflictError extends Error {}
export class UserInvitationUnavailableError extends Error {}
export class UserNotFoundError extends Error {
  constructor() {
    super('Usuario nao encontrado.')
  }
}

function userSelect(): string {
  return `select
    u.id,
    u.email::text,
    u.name,
    u.avatar_url,
    u.status,
    u.platform_admin,
    c.must_change_password,
    u.created_at,
    m.id as membership_id,
    m.status as membership_status,
    m.company_id,
    m.allowed_company_ids,
    m.allowed_group_ids,
    m.profile_key,
    r.role_key,
    coalesce((
      select jsonb_object_agg(rp.permission_key, rp.allowed)
      from role_permissions rp where rp.role_id = r.id
    ), '{}'::jsonb) || m.custom_permissions as permissions
  from tenant_memberships m
  join users u on u.id = m.user_id
  join user_credentials c on c.user_id = u.id
  join roles r on r.id = m.role_id and (r.tenant_id = m.tenant_id or r.tenant_id is null)`
}

function rowToUser(row: MembershipUserRow, principal: RequestPrincipal): User {
  const profile = normalizeProfile(row.profile_key, row.role_key)
  const permissions = normalizePermissions(row.permissions, profile)
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: userRoleFromRoleKey(row.role_key),
    tenant_id: principal.tenantId,
    tenant_slug: principal.tenantSlug,
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
    ativo: row.status === 'active' && row.membership_status === 'active',
    status: normalizeUserStatus(row.membership_status === 'invited' ? 'invited' : row.status),
    created_at: row.created_at.toISOString(),
  }
}

function normalizeUserStatus(value: string): NonNullable<User['status']> {
  if (value === 'invited' || value === 'active' || value === 'blocked' || value === 'inactive') return value
  return 'inactive'
}

async function cleanupFailedInvitation(tenantId: string, userId: string): Promise<void> {
  try {
    await withTransaction(async (client) => {
      await client.query(
        `delete from users u
         where u.id = $1 and u.status = 'invited'
           and exists (
             select 1 from tenant_memberships m
             where m.user_id = u.id and m.tenant_id = $2 and m.status = 'invited'
           )`,
        [userId, tenantId],
      )
    })
  } catch (error) {
    logError('tenant_user_invite_cleanup_failed', error, {
      errorCode: 'TENANT_USER_INVITE_CLEANUP_FAILED',
      tenantId,
      userId,
    })
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character)
}

async function sendUserInvitationEmail(args: { email: string; name: string; token: string }): Promise<void> {
  const environment = getServerEnvironment()
  const inviteUrl = new URL('/aceitar-convite', environment.APP_URL)
  inviteUrl.searchParams.set('token', args.token)
  await sendTransactionalEmail({
    to: args.email,
    subject: 'Convite para o BBT Corporativo',
    text: `Ola, ${args.name}. Voce recebeu acesso ao BBT Corporativo. Defina sua senha em: ${inviteUrl.toString()}\n\nO link expira em 72 horas.`,
    html: `<p>Ola, ${escapeHtml(args.name)}.</p><p>Voce recebeu acesso ao <strong>BBT Corporativo</strong>.</p><p><a href="${escapeHtml(inviteUrl.toString())}">Aceitar convite e definir senha</a></p><p>O link expira em 72 horas.</p>`,
  })
}

function roleKeyFrom(role: UserRole, profile?: PerfilBBT): string {
  if (role === 'company_admin') return 'company_admin'
  if (role === 'colaborador') return 'requester'
  if (profile === 'lider') return 'tenant_admin'
  if (profile === 'gestor_financeiro') return 'financial_manager'
  if (profile === 'supervisor') return 'supervisor'
  if (profile === 'agente') return 'agent'
  return 'operator'
}

function userRoleFromRoleKey(roleKey: string): UserRole {
  if (roleKey === 'company_admin') return 'company_admin'
  if (roleKey === 'requester' || roleKey === 'readonly') return 'colaborador'
  return 'master'
}

function profileFromRoleKey(roleKey: string): PerfilBBT {
  if (roleKey === 'tenant_admin') return 'lider'
  if (roleKey === 'financial_manager') return 'gestor_financeiro'
  if (roleKey === 'supervisor') return 'supervisor'
  if (roleKey === 'agent') return 'agente'
  return 'operacional'
}

function normalizeProfile(value: string | null, roleKey: string): PerfilBBT {
  if (value && Object.prototype.hasOwnProperty.call(PERMISSOES_PADRAO_POR_PERFIL, value)) return value as PerfilBBT
  return profileFromRoleKey(roleKey)
}

function normalizePermissions(value: Record<string, unknown> | null, profile: PerfilBBT): Permissoes {
  const defaults = PERMISSOES_PADRAO_POR_PERFIL[profile]
  return Object.fromEntries(Object.keys(defaults).map((key) => [
    key,
    typeof value?.[key] === 'boolean' ? value[key] : defaults[key as keyof Permissoes],
  ])) as unknown as Permissoes
}

function normalizePermissionPatch(value: Partial<Permissoes> | undefined): Record<string, boolean> {
  if (!value) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 1_000)
}

async function enforceUserLimit(principal: RequestPrincipal): Promise<void> {
  if (!principal.limits.users) return
  const result = await queryDatabase<{ count: string }>(
    `select count(*)::text as count
     from tenant_memberships
     where tenant_id = $1 and status in ('active', 'invited')`,
    [principal.tenantId],
  )
  if (Number(result.rows[0]?.count || 0) >= principal.limits.users) {
    throw new UserConflictError('Limite de usuarios do plano atingido.')
  }
}
