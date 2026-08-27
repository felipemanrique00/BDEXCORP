import 'server-only'

import { randomUUID } from 'node:crypto'

import { hashPassword } from '@/lib/security/password'
import { corporateProfileToMembershipRoleKey } from '@/lib/corporate-access'
import type { CorporateAccessConfigurationInput } from '@/lib/corporate-access-schema'
import {
  assertStrongPassword,
  revokeTenantUserSessions,
  revokeUserSessions,
} from '@/lib/server/auth-service'
import {
  applyCorporateAccessConfigurationInTransaction,
  assertCorporateAccessDelegation,
  getUserCorporateAccessConfiguration,
  mergeUserCorporateAccess,
  replaceUserCorporateAccess,
  requireCompleteCorporateAccessManagement,
} from '@/lib/server/corporate-access-admin-service'
import { CorporateAccessDeniedError } from '@/lib/server/corporate-access-service'
import {
  applyDatabaseSecurityContext,
  withTenantTransaction,
} from '@/lib/server/database'
import { emailConfigured, sendTransactionalEmail } from '@/lib/server/email'
import { getServerEnvironment } from '@/lib/server/environment'
import {
  assertEmployeeAuthorizerIdentityMutationAllowedInTransaction,
  assertGenericEmployeeAuthorizerActivationAllowedInTransaction,
  EmployeeAuthorizerServiceError,
  markEmployeeAuthorizerInviteDeliveryState,
  rebindPendingEmployeeAuthorizerInviteInTransaction,
  revokeInvalidEmployeeAuthorizerLinksInTransaction,
} from '@/lib/server/employee-authorizer-service'
import { logError } from '@/lib/server/logger'
import {
  applyPermissionOverrides,
  normalizeInternalPermissionBases,
  normalizePermissionOverrides,
  permissionOverridesFromEffective,
  type InternalPermissionBases,
} from '@/lib/permission-overrides'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  isSelfDeactivation,
  isUnsafeSelfAdministrationChange,
  resolveUserAvatarUpdate,
} from '@/lib/user-mutation'
import {
  canDelegateTenantOwner,
  changesTenantOwnerMembership,
} from '@/lib/tenant-owner-access'
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
  corporate_profile: import('@/types').CorporateProfile | null
  permissions: Record<string, unknown> | null
  permission_overrides: Record<string, unknown> | null
}

const INTERNAL_PROFILE_BY_ROLE_KEY: Record<string, PerfilBBT> = {
  tenant_admin: 'lider',
  financial_manager: 'gestor_financeiro',
  supervisor: 'supervisor',
  agent: 'agente',
  operator: 'operacional',
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
  corporateAccess?: CorporateAccessConfigurationInput
}

export interface TenantUserCreationResult {
  user: User
  existing: boolean
  invited: boolean
}

export async function listTenantUsers(principal: RequestPrincipal): Promise<User[]> {
  return queryTenantUsers(principal, 'management')
}

export async function listTenantInternalPermissionBases(
  principal: RequestPrincipal,
): Promise<InternalPermissionBases> {
  const configured = await withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<{
      role_key: string
      permissions: Record<string, unknown> | null
    }>(
      `select
         role_row.role_key,
         coalesce(
           jsonb_object_agg(permission.permission_key, permission.allowed)
             filter (where permission.permission_key is not null),
           '{}'::jsonb
         ) as permissions
       from roles role_row
       left join role_permissions permission on permission.role_id = role_row.id
       where role_row.tenant_id = $1
         and role_row.role_key = any($2::text[])
       group by role_row.id, role_row.role_key`,
      [principal.tenantId, Object.keys(INTERNAL_PROFILE_BY_ROLE_KEY)],
    )
    return Object.fromEntries(result.rows.flatMap((row) => {
      const profile = INTERNAL_PROFILE_BY_ROLE_KEY[row.role_key]
      return profile ? [[profile, row.permissions || {}]] : []
    }))
  })
  return normalizeInternalPermissionBases(configured)
}

export async function listTenantDirectory(principal: RequestPrincipal): Promise<User[]> {
  const users = await queryTenantUsers(principal, 'visible')
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
      corporate_profile: user.corporate_profile,
      permissoes: user.permissoes,
      avatar: user.avatar,
      ativo: user.ativo,
      created_at: user.created_at,
    }))
}

async function queryTenantUsers(
  principal: RequestPrincipal,
  scope: 'visible' | 'management',
): Promise<User[]> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<MembershipUserRow>(`${userSelect()}
      where m.tenant_id = $1 and u.deleted_at is null
      ${userVisibilityPredicate()}
      order by u.name asc`, userVisibilityParameters(principal, scope))
    return result.rows.map((row) => rowToUser(row, principal, scope))
  })
}

export async function createTenantUser(
  principal: RequestPrincipal,
  input: UserMutationInput,
): Promise<TenantUserCreationResult> {
  const invited = !input.password
  if (input.password) assertStrongPassword(input.password)
  const email = input.email.trim().toLowerCase()
  const name = input.name.trim()
  assertLegacyUserMutationAllowed(principal, input)
  assertMembershipPermissionOverridesAllowed(principal, input.permissions)
  if (input.corporateAccess) {
    assertCorporateAccessDelegation(
      principal,
      corporateAccessWithoutEmployeeDecision(input.corporateAccess),
      { requireAtLeastOneGrant: true },
    )
  }
  const corporateProfile = primaryCorporateProfile(input.corporateAccess)
  const roleKey = corporateProfile
    ? corporateProfileToMembershipRoleKey(corporateProfile)
    : roleKeyFrom(input.role, input.profile)
  assertTenantOwnerMembershipChangeAllowed(principal, null, roleKey)

  const existingIdentity = await withTenantTransaction(
    principal.tenantId,
    (client) => client.query<{ user_id: string; membership_id: string | null }>(
      `select user_row.id as user_id, membership.id as membership_id
       from users user_row
       left join tenant_memberships membership
         on membership.user_id = user_row.id and membership.tenant_id = $2
       where user_row.email = $1 and user_row.deleted_at is null
       limit 1`,
      [email, principal.tenantId],
    ),
  )
  const existing = existingIdentity.rows[0]
  if (existing?.membership_id) {
    if (!input.corporateAccess) throw new UserConflictError('Este e-mail ja possui acesso ao tenant.')
    await mergeUserCorporateAccess(principal, existing.user_id, input.corporateAccess)
    const user = await getTenantUser(principal, existing.user_id)
    if (!user) throw new Error('Acesso atualizado, mas o usuario nao pode ser recarregado.')
    return { user, existing: true, invited: user.status === 'invited' }
  }
  if (existing) {
    throw new UserConflictError('Este e-mail pertence a outro workspace. Use um convite de associacao entre tenants.')
  }
  if (invited && !emailConfigured()) {
    throw new UserInvitationUnavailableError('SMTP deve estar configurado para enviar convites.')
  }
  await enforceUserLimit(principal)

  const passwordHash = await hashPassword(input.password || createOpaqueToken(48))
  const userId = randomUUID()
  const membershipId = randomUUID()
  const inviteToken = invited ? createOpaqueToken() : null
  const inviteHash = inviteToken ? hashSecureToken(inviteToken, 'user-invite') : null

  await withTenantTransaction(principal.tenantId, async (client) => {
    const duplicate = await client.query(
      'select 1 from users where email = $1 and deleted_at is null',
      [email],
    )
    if (duplicate.rowCount) throw new UserConflictError('Ja existe usuario com este e-mail.')

    const role = await client.query<{
      id: string
      permissions: Record<string, unknown> | null
    }>(
      `select
         role_row.id,
         coalesce(
           jsonb_object_agg(permission.permission_key, permission.allowed)
             filter (where permission.permission_key is not null),
           '{}'::jsonb
         ) as permissions
       from roles role_row
       left join role_permissions permission on permission.role_id = role_row.id
       where role_row.tenant_id = $1 and role_row.role_key = $2
       group by role_row.id`,
      [principal.tenantId, roleKey],
    )
    if (!role.rowCount) throw new Error('Perfil de acesso nao configurado para o tenant.')
    const targetProfile = input.profile || profileFromRoleKey(roleKey)
    const rolePermissionBase = normalizePermissions(role.rows[0].permissions, targetProfile)
    const permissionPatch = normalizePermissionPatch(input.permissions, rolePermissionBase)

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
        targetProfile,
        JSON.stringify(permissionPatch),
        input.companyId || null,
        uniqueStrings(input.companyIds || []),
        uniqueStrings(input.groupIds || []),
      ],
    )
    if (input.corporateAccess) {
      await applyCorporateAccessConfigurationInTransaction(
        client,
        principal,
        membershipId,
        input.corporateAccess,
      )
    }
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
  return { user: created, existing: false, invited }
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
  if (!isTenantAccessAdministrator(principal)) {
    await getUserCorporateAccessConfiguration(principal, userId)
  }
  if (user.status !== 'invited') throw new UserConflictError('Somente convites pendentes podem ser reenviados.')

  const inviteId = randomUUID()
  const inviteToken = createOpaqueToken()
  const inviteHash = hashSecureToken(inviteToken, 'user-invite')
  await withTenantTransaction(principal.tenantId, async (client) => {
    const membership = await client.query<{ id: string }>(
      `select id from tenant_memberships
       where tenant_id = $1 and user_id = $2 and status = 'invited'
       for update`,
      [principal.tenantId, userId],
    )
    if (!membership.rowCount) throw new UserConflictError('Convite pendente nao encontrado.')
    await client.query(
      `update user_invites set expires_at = least(expires_at, now())
       where tenant_id = $1 and membership_id = $2 and accepted_at is null`,
      [principal.tenantId, membership.rows[0].id],
    )
    await client.query(
      `insert into user_invites (id, tenant_id, user_id, membership_id, token_hash, expires_at, created_by)
       values ($1, $2, $3, $4, $5, now() + interval '72 hours', $6)`,
      [inviteId, principal.tenantId, userId, membership.rows[0].id, inviteHash, principal.user.id],
    )
    await rebindPendingEmployeeAuthorizerInviteInTransaction(
      client,
      principal.tenantId,
      membership.rows[0].id,
      inviteId,
    )
  })

  try {
    await sendUserInvitationEmail({ email: user.email, name: user.name, token: inviteToken })
    await markEmployeeAuthorizerInviteDeliveryState(principal.tenantId, inviteId, 'sent')
  } catch (error) {
    logError('tenant_user_invite_retry_delivery_failed', error, {
      errorCode: 'TENANT_USER_INVITE_RETRY_DELIVERY_FAILED',
      tenantId: principal.tenantId,
      userId,
      inviteId,
      invitationState: 'delivery_pending',
    })
    throw new UserInvitationUnavailableError('Nao foi possivel reenviar o convite. Verifique o SMTP e tente novamente.')
  }
}

export async function updateTenantUser(
  principal: RequestPrincipal,
  userId: string,
  input: UserMutationInput,
): Promise<User> {
  if (isSelfDeactivation(principal.user.id, userId, input.active)) {
    throw new UserConflictError('Voce nao pode desativar o proprio acesso.')
  }
  const current = await getTenantUser(principal, userId)
  if (!current) throw new UserNotFoundError()
  if (current.platform_admin && userId !== principal.user.id) {
    throw new UserConflictError('Administrador da plataforma nao pode ser alterado por outro usuario do tenant.')
  }
  if (input.password) assertStrongPassword(input.password)
  assertLegacyUserMutationAllowed(principal, input)
  assertMembershipPermissionOverridesAllowed(principal, input.permissions)
  if (input.corporateAccess) {
    assertCorporateAccessDelegation(
      principal,
      corporateAccessWithoutEmployeeDecision(input.corporateAccess),
    )
  }
  const nextAvatar = resolveUserAvatarUpdate(current.avatar, input.avatar)
  const changesSharedIdentity = input.name.trim() !== current.name
    || input.email.trim().toLowerCase() !== current.email.toLowerCase()
    || nextAvatar !== (current.avatar || null)
    || Boolean(input.password)

  if (!isTenantAccessAdministrator(principal)) {
    if (!input.corporateAccess) {
      throw new CorporateAccessDeniedError(
        'ACCESS_MANAGEMENT_DENIED',
        'Administradores delegados podem alterar somente o escopo corporativo.',
      )
    }
    if (input.password) {
      throw new CorporateAccessDeniedError(
        'IDENTITY_MANAGEMENT_DENIED',
        'Administradores delegados nao podem redefinir a senha desta identidade.',
      )
    }
    const changesRestrictedIdentity = changesSharedIdentity
      || input.email.trim().toLowerCase() !== current.email.toLowerCase()
      || (typeof input.active === 'boolean' && input.active !== (current.ativo !== false))
    if (changesRestrictedIdentity) {
      throw new CorporateAccessDeniedError(
        'IDENTITY_MANAGEMENT_DENIED',
        'Nome, e-mail e estado global exigem administracao completa do tenant.',
      )
    }
    await replaceUserCorporateAccess(principal, userId, input.corporateAccess)
    const updated = await getTenantUser(principal, userId)
    if (!updated) throw new Error('Acesso alterado, mas nao foi possivel recarregar o cadastro.')
    return updated
  }

  const corporateProfile = primaryCorporateProfile(input.corporateAccess)
  const roleKey = corporateProfile
    ? corporateProfileToMembershipRoleKey(corporateProfile)
    : roleKeyFrom(input.role, input.profile)
  assertTenantOwnerMembershipChangeAllowed(principal, current.role_key, roleKey)
  if (isUnsafeSelfAdministrationChange({
    actorUserId: principal.user.id,
    targetUserId: userId,
    actorRoleKey: principal.roleKey,
    nextRoleKey: roleKey,
    platformAdmin: principal.platformAdmin,
    hasExplicitScope: Boolean(
      input.corporateAccess
      || input.companyId
      || input.companyIds?.length
      || input.groupIds?.length,
    ),
  })) {
    throw new UserConflictError(
      'Voce nao pode alterar o proprio perfil ou escopo de forma que remova sua administracao de usuarios.',
    )
  }
  const nextMembershipStatus = current.status === 'invited'
    ? input.password ? 'active' : 'invited'
    : input.active === false ? 'inactive' : 'active'
  const emailChanged = input.email.trim().toLowerCase() !== current.email.toLowerCase()
  const invalidatesEmployeeIdentity = emailChanged
    || nextMembershipStatus === 'inactive'
    || Object.prototype.hasOwnProperty.call(INTERNAL_PROFILE_BY_ROLE_KEY, roleKey)
  const activatesEmployeeInviteOutsideAcceptance = current.status === 'invited' && Boolean(input.password)
  await withTenantTransaction(principal.tenantId, async (client) => {
    if (!current.membership_id) throw new UserNotFoundError()
    if (activatesEmployeeInviteOutsideAcceptance) {
      await translateEmployeeAuthorizerConflict(() =>
        assertGenericEmployeeAuthorizerActivationAllowedInTransaction(
          client,
          principal.tenantId,
          current.membership_id!,
        ))
    }
    if (invalidatesEmployeeIdentity) {
      await translateEmployeeAuthorizerConflict(() =>
        assertEmployeeAuthorizerIdentityMutationAllowedInTransaction(
          client,
          principal.tenantId,
          current.membership_id!,
        ))
    }
    if (changesSharedIdentity && !principal.platformAdmin) {
      await applyDatabaseSecurityContext(client, { identityUserId: userId })
      const memberships = await client.query<{ tenant_count: number; current_tenant: boolean }>(
        `select count(distinct tenant_id)::integer as tenant_count,
                coalesce(bool_or(tenant_id = $2::uuid), false) as current_tenant
         from tenant_memberships
         where user_id = $1`,
        [userId, principal.tenantId],
      )
      const ownership = memberships.rows[0]
      if (!ownership?.current_tenant || ownership.tenant_count !== 1) {
        throw new CorporateAccessDeniedError(
          'SHARED_IDENTITY_MANAGEMENT_DENIED',
          'Esta identidade possui acesso a outro tenant. Altere somente o perfil e o escopo deste tenant.',
        )
      }
    }

    const duplicate = await client.query(
      'select 1 from users where email = $1 and id <> $2 and deleted_at is null',
      [input.email.trim().toLowerCase(), userId],
    )
    if (duplicate.rowCount) throw new UserConflictError('Ja existe usuario com este e-mail.')

    const role = await client.query<{
      id: string
      permissions: Record<string, unknown> | null
    }>(
      `select
         role_row.id,
         coalesce(
           jsonb_object_agg(permission.permission_key, permission.allowed)
             filter (where permission.permission_key is not null),
           '{}'::jsonb
         ) as permissions
       from roles role_row
       left join role_permissions permission on permission.role_id = role_row.id
       where role_row.tenant_id = $1 and role_row.role_key = $2
       group by role_row.id`,
      [principal.tenantId, roleKey],
    )
    if (!role.rowCount) throw new Error('Perfil de acesso nao configurado para o tenant.')
    const targetProfile = input.profile || profileFromRoleKey(roleKey)
    const rolePermissionBase = normalizePermissions(role.rows[0].permissions, targetProfile)
    const permissionPatch = normalizePermissionPatch(input.permissions, rolePermissionBase)
    const targetPermissions = applyPermissionOverrides(rolePermissionBase, permissionPatch)
    if (
      userId === principal.user.id
      && !principal.platformAdmin
      && (
        !targetPermissions.gerenciar_usuarios
        || !targetPermissions.gerenciar_vinculos_acesso
      )
    ) {
      throw new UserConflictError(
        'Voce nao pode remover o proprio acesso de administracao de usuarios.',
      )
    }

    await client.query(
      `update users set
         email = $2,
         name = $3,
         avatar_url = $4,
         status = case when status = 'invited' and $5::boolean then 'active' else status end
       where id = $1`,
      [
        userId,
        input.email.trim().toLowerCase(),
        input.name.trim(),
        nextAvatar,
        current.status === 'invited' && Boolean(input.password),
      ],
    )
    const membership = await client.query<{ id: string }>(
      `update tenant_memberships set
         role_id = $3,
         status = $4,
         profile_key = $5,
         custom_permissions = $6::jsonb,
         company_id = case when $7::boolean then company_id else $8 end,
         allowed_company_ids = case when $7::boolean then allowed_company_ids else $9::text[] end,
         allowed_group_ids = case when $7::boolean then allowed_group_ids else $10::text[] end
       where tenant_id = $1 and user_id = $2
       returning id`,
      [
        principal.tenantId,
        userId,
        role.rows[0].id,
        nextMembershipStatus,
        targetProfile,
        JSON.stringify(permissionPatch),
        Boolean(input.corporateAccess),
        input.companyId || null,
        uniqueStrings(input.companyIds || []),
        uniqueStrings(input.groupIds || []),
      ],
    )
    if (!membership.rowCount) throw new UserNotFoundError()
    if (input.corporateAccess) {
      await applyCorporateAccessConfigurationInTransaction(
        client,
        principal,
        membership.rows[0].id,
        input.corporateAccess,
      )
    } else if (isTenantAccessAdministrator(principal)) {
      await revokeCorporateAccessInTransaction(client, principal.tenantId, membership.rows[0].id)
    }
    if (invalidatesEmployeeIdentity) {
      await revokeInvalidEmployeeAuthorizerLinksInTransaction(
        client,
        principal.tenantId,
        principal.user.id,
      )
    }
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

  if (input.password) await revokeUserSessions(userId, 'password_changed_by_admin')
  if (input.active === false) {
    await revokeTenantUserSessions(principal.tenantId, userId, 'tenant_access_deactivated')
  }
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
  assertTenantOwnerMembershipChangeAllowed(principal, existing.role_key, existing.role_key)
  if (!isTenantAccessAdministrator(principal)) {
    await requireCompleteCorporateAccessManagement(principal, userId)
  }
  if (active && existing.status === 'invited') {
    throw new UserConflictError('Convite pendente. O usuario deve aceitar o convite ou receber uma senha temporaria antes da ativacao.')
  }

  await withTenantTransaction(principal.tenantId, async (client) => {
    if (!existing.membership_id) throw new UserNotFoundError()
    if (!active) {
      await translateEmployeeAuthorizerConflict(() =>
        assertEmployeeAuthorizerIdentityMutationAllowedInTransaction(
          client,
          principal.tenantId,
          existing.membership_id!,
        ))
    }
    const membership = await client.query<{ id: string }>(
      `update tenant_memberships
       set status = $3, updated_at = now()
       where tenant_id = $1 and user_id = $2
       returning id`,
      [principal.tenantId, userId, active ? 'active' : 'inactive'],
    )
    if (!membership.rowCount) throw new UserNotFoundError()
    if (!active) {
      await revokeInvalidEmployeeAuthorizerLinksInTransaction(
        client,
        principal.tenantId,
        principal.user.id,
      )
    }
  })
  if (!active) {
    await revokeTenantUserSessions(principal.tenantId, userId, 'tenant_access_deactivated')
  }
  const updated = await getTenantUser(principal, userId)
  if (!updated) throw new Error('Usuario alterado, mas nao foi possivel recarregar o cadastro.')
  return updated
}

export async function getTenantUser(principal: RequestPrincipal, userId: string): Promise<User | null> {
  return withTenantTransaction(principal.tenantId, async (client) => {
    const result = await client.query<MembershipUserRow>(`${userSelect()}
      where m.tenant_id = $1 and u.id = $2 and u.deleted_at is null
      ${userVisibilityPredicate(3, 4, 5)}
      limit 1`, [principal.tenantId, userId, ...userVisibilityParameters(principal).slice(1)])
    return result.rows[0] ? rowToUser(result.rows[0], principal, 'visible') : null
  })
}

export class UserConflictError extends Error {}
export class UserInvitationUnavailableError extends Error {}
export class UserNotFoundError extends Error {
  constructor() {
    super('Usuario nao encontrado.')
  }
}

async function translateEmployeeAuthorizerConflict(operation: () => Promise<void>): Promise<void> {
  try {
    await operation()
  } catch (error) {
    if (error instanceof EmployeeAuthorizerServiceError) {
      throw new UserConflictError(error.message)
    }
    throw error
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
    coalesce(
      (select grant_row.corporate_profile
       from corporate_group_access_grants grant_row
       where grant_row.tenant_id = m.tenant_id and grant_row.membership_id = m.id
         and grant_row.status <> 'revoked'
       order by grant_row.created_at asc limit 1),
      (select grant_row.corporate_profile
       from corporate_company_access_grants grant_row
       where grant_row.tenant_id = m.tenant_id and grant_row.membership_id = m.id
         and grant_row.status <> 'revoked'
       order by grant_row.created_at asc limit 1)
    ) as corporate_profile,
    coalesce((
      select jsonb_object_agg(rp.permission_key, rp.allowed)
      from role_permissions rp where rp.role_id = r.id
    ), '{}'::jsonb) || m.custom_permissions as permissions,
    m.custom_permissions as permission_overrides
  from tenant_memberships m
  join users u on u.id = m.user_id
  join user_credentials c on c.user_id = u.id
  join roles r on r.id = m.role_id and (r.tenant_id = m.tenant_id or r.tenant_id is null)`
}

function rowToUser(
  row: MembershipUserRow,
  principal: RequestPrincipal,
  scope: 'visible' | 'management',
): User {
  const profile = normalizeProfile(row.profile_key, row.role_key)
  const permissions = normalizePermissions(row.permissions, profile)
  const actorCompanyIds = new Set(principalCompanyIdsForScope(principal, scope))
  const companyIds = isTenantAccessAdministrator(principal)
    ? uniqueStrings(row.allowed_company_ids || [])
    : uniqueStrings(row.allowed_company_ids || []).filter((companyId) => actorCompanyIds.has(companyId))
  const groupIds = isTenantAccessAdministrator(principal)
    ? uniqueStrings(row.allowed_group_ids || [])
    : uniqueStrings(row.allowed_group_ids || []).filter((groupId) => (
        principal.corporateAccess?.groups.some((group) => (
          group.groupId === groupId
          && group.companyIds.some((companyId) => actorCompanyIds.has(companyId))
        ))
      ))
  const companyId = row.company_id && (isTenantAccessAdministrator(principal)
    || actorCompanyIds.has(row.company_id))
    ? row.company_id
    : companyIds[0] || null
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
    company_id: companyId,
    empresa_ids: companyIds,
    grupo_ids: groupIds,
    perfil_bbt: profile,
    corporate_profile: row.corporate_profile || undefined,
    permissoes: permissions,
    permission_overrides: normalizePermissionOverrides(row.permission_overrides),
    avatar: row.avatar_url || undefined,
    ativo: row.status === 'active' && row.membership_status === 'active',
    status: effectiveUserStatus(row.status, row.membership_status),
    created_at: row.created_at.toISOString(),
  }
}

function normalizeUserStatus(value: string): NonNullable<User['status']> {
  if (value === 'invited' || value === 'active' || value === 'blocked' || value === 'inactive') return value
  return 'inactive'
}

function effectiveUserStatus(globalStatus: string, membershipStatus: string): NonNullable<User['status']> {
  if (membershipStatus === 'invited') return 'invited'
  if (membershipStatus === 'inactive') return 'inactive'
  if (membershipStatus === 'suspended') return 'blocked'
  return normalizeUserStatus(globalStatus)
}

async function cleanupFailedInvitation(tenantId: string, userId: string): Promise<void> {
  try {
    await withTenantTransaction(tenantId, async (client) => {
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

function normalizePermissionPatch(
  value: Partial<Permissoes> | undefined,
  base?: Permissoes,
): Record<string, boolean> {
  const normalized = normalizePermissionOverrides(value)
  if (!base) return normalized as Record<string, boolean>
  return permissionOverridesFromEffective(
    base,
    applyPermissionOverrides(base, normalized),
  ) as Record<string, boolean>
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 1_000)
}

function primaryCorporateProfile(input: CorporateAccessConfigurationInput | undefined) {
  return input?.groupGrants[0]?.profile || input?.companyGrants[0]?.profile
}

function corporateAccessWithoutEmployeeDecision(
  input: CorporateAccessConfigurationInput,
): CorporateAccessConfigurationInput {
  return {
    ...input,
    groupGrants: input.groupGrants.map((grant) => ({
      ...grant,
      permissionOverrides: {
        ...grant.permissionOverrides,
        decidir_aprovacoes: false,
      },
    })),
    companyGrants: input.companyGrants.map((grant) => ({
      ...grant,
      permissionOverrides: {
        ...grant.permissionOverrides,
        decidir_aprovacoes: false,
      },
    })),
  }
}

async function revokeCorporateAccessInTransaction(
  client: import('pg').PoolClient,
  tenantId: string,
  membershipId: string,
): Promise<void> {
  await client.query(
    `update corporate_group_access_grants
     set status = 'revoked', updated_at = now()
     where tenant_id = $1 and membership_id = $2 and status <> 'revoked'`,
    [tenantId, membershipId],
  )
  await client.query(
    `update corporate_company_access_grants
     set status = 'revoked', updated_at = now()
     where tenant_id = $1 and membership_id = $2 and status <> 'revoked'`,
    [tenantId, membershipId],
  )
  await client.query(
    'delete from membership_corporate_preferences where tenant_id = $1 and membership_id = $2',
    [tenantId, membershipId],
  )
}

function assertLegacyUserMutationAllowed(principal: RequestPrincipal, input: UserMutationInput): void {
  if (input.corporateAccess || isTenantAccessAdministrator(principal)) return
  throw new CorporateAccessDeniedError(
    'LEGACY_ACCESS_MANAGEMENT_DENIED',
    'Use o escopo corporativo para gerenciar este usuario. Apenas administradores do tenant podem alterar acessos legados.',
  )
}

function assertMembershipPermissionOverridesAllowed(
  principal: RequestPrincipal,
  permissions: Partial<Permissoes> | undefined,
): void {
  if (
    isTenantAccessAdministrator(principal)
    || Object.keys(normalizePermissionOverrides(permissions)).length === 0
  ) return
  throw new CorporateAccessDeniedError(
    'MEMBERSHIP_PERMISSION_DELEGATION_DENIED',
    'Administradores corporativos devem personalizar somente as permissoes dos vinculos delegados.',
  )
}

function assertTenantOwnerMembershipChangeAllowed(
  principal: RequestPrincipal,
  currentRoleKey: string | null | undefined,
  nextRoleKey: string | null | undefined,
): void {
  if (!changesTenantOwnerMembership(currentRoleKey, nextRoleKey)) return
  if (canDelegateTenantOwner({
    platformAdmin: principal.platformAdmin,
    roleKey: principal.roleKey,
    permissions: principal.user.permissoes,
  })) return
  throw new CorporateAccessDeniedError(
    'TENANT_OWNER_DELEGATION_DENIED',
    'Somente um Dono do ambiente pode criar, promover ou alterar outro Dono.',
  )
}

function isTenantAccessAdministrator(principal: RequestPrincipal): boolean {
  if (principal.platformAdmin) return true
  if (!Object.prototype.hasOwnProperty.call(INTERNAL_PROFILE_BY_ROLE_KEY, principal.roleKey)) return false
  if (principal.roleKey !== 'tenant_admin' && principal.corporateAccess?.tenantWide !== true) return false
  return Boolean(
    principal.user.permissoes?.gerenciar_usuarios
    && principal.user.permissoes?.gerenciar_vinculos_acesso,
  )
}

function userVisibilityParameters(
  principal: RequestPrincipal,
  scope: 'visible' | 'management' = 'visible',
): [string, boolean, string, string[]] {
  const companyIds = principalCompanyIdsForScope(principal, scope)
  return [
    principal.tenantId,
    isTenantAccessAdministrator(principal)
      || (scope === 'visible' && Boolean(principal.corporateAccess?.tenantWide)),
    principal.user.id,
    companyIds,
  ]
}

function principalCompanyIdsForScope(
  principal: RequestPrincipal,
  scope: 'visible' | 'management',
): string[] {
  if (principal.corporateAccess) {
    return principal.corporateAccess.companies
      .filter((company) => scope === 'visible' || (
        company.permissions.gerenciar_usuarios
        && company.permissions.gerenciar_vinculos_acesso
      ))
      .map((company) => company.companyId)
  }
  return uniqueStrings([
    principal.user.company_id || '',
    ...(principal.user.empresa_ids || []),
  ])
}

function userVisibilityPredicate(
  allUsersParameter = 2,
  actorUserParameter = 3,
  companyIdsParameter = 4,
): string {
  return `and (
    $${allUsersParameter}::boolean
    or m.user_id = $${actorUserParameter}
    or (
      cardinality($${companyIdsParameter}::text[]) > 0
      and (
        exists (
          select 1 from corporate_company_access_grants direct_grant
          where direct_grant.tenant_id = m.tenant_id
            and direct_grant.membership_id = m.id
            and direct_grant.company_id = any($${companyIdsParameter}::text[])
            and direct_grant.status = 'active'
            and direct_grant.valid_from <= now()
            and (direct_grant.valid_until is null or direct_grant.valid_until > now())
        )
        or exists (
          select 1
          from corporate_group_access_grants group_grant
          join corporate_group_access_companies selected
            on selected.tenant_id = group_grant.tenant_id
           and selected.group_access_grant_id = group_grant.id
          where group_grant.tenant_id = m.tenant_id
            and group_grant.membership_id = m.id
            and selected.company_id = any($${companyIdsParameter}::text[])
            and group_grant.status = 'active'
            and group_grant.valid_from <= now()
            and (group_grant.valid_until is null or group_grant.valid_until > now())
        )
        or exists (
          select 1
          from corporate_group_access_grants group_grant
          join companies company_row
            on company_row.tenant_id = group_grant.tenant_id
           and company_row.group_id = group_grant.business_group_id
          where group_grant.tenant_id = m.tenant_id
            and group_grant.membership_id = m.id
            and group_grant.access_mode = 'all_companies'
            and company_row.id = any($${companyIdsParameter}::text[])
            and company_row.status = 'active'
            and group_grant.status = 'active'
            and group_grant.valid_from <= now()
            and (group_grant.valid_until is null or group_grant.valid_until > now())
        )
        or (
          not exists (
            select 1 from corporate_group_access_grants configured_group
            where configured_group.tenant_id = m.tenant_id and configured_group.membership_id = m.id
          )
          and not exists (
            select 1 from corporate_company_access_grants configured_company
            where configured_company.tenant_id = m.tenant_id and configured_company.membership_id = m.id
          )
          and (
            m.company_id = any($${companyIdsParameter}::text[])
            or coalesce(m.allowed_company_ids, '{}') && $${companyIdsParameter}::text[]
            or exists (
              select 1 from companies legacy_group_company
              where legacy_group_company.tenant_id = m.tenant_id
                and legacy_group_company.id = any($${companyIdsParameter}::text[])
                and legacy_group_company.group_id = any(coalesce(m.allowed_group_ids, '{}'))
            )
          )
        )
      )
    )
  )`
}

async function enforceUserLimit(principal: RequestPrincipal): Promise<void> {
  if (!principal.limits.users) return
  const result = await withTenantTransaction(
    principal.tenantId,
    (client) => client.query<{ count: string }>(
      `select count(*)::text as count
       from tenant_memberships
       where tenant_id = $1 and status in ('active', 'invited')`,
      [principal.tenantId],
    ),
  )
  if (Number(result.rows[0]?.count || 0) >= principal.limits.users) {
    throw new UserConflictError('Limite de usuarios do plano atingido.')
  }
}
