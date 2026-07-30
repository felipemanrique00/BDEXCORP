import 'server-only'

import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'

import {
  permissionOverridesOnly,
  permissionsForCorporateProfile,
} from '@/lib/corporate-access'
import type { CorporateAccessConfigurationInput } from '@/lib/corporate-access-schema'
import {
  CorporateAccessDeniedError,
  resolveCorporateContext,
} from '@/lib/server/corporate-access-service'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import type { CorporateProfile, Permissoes } from '@/types'

export interface CorporateAccessConfiguration {
  membershipId: string
  groupGrants: Array<{
    id: string
    groupId: string
    groupName: string
    profile: CorporateProfile
    accessMode: 'all_companies' | 'selected_companies'
    companyIds: string[]
    canViewConsolidated: boolean
    permissionOverrides: Partial<Permissoes>
    status: 'active' | 'suspended'
    validFrom: string
    validUntil: string | null
  }>
  companyGrants: Array<{
    id: string
    companyId: string
    companyName: string
    profile: CorporateProfile
    permissionOverrides: Partial<Permissoes>
    status: 'active' | 'suspended'
    validFrom: string
    validUntil: string | null
  }>
  defaultContext: { type: 'company' | 'group'; id: string } | null
}

interface TargetMembershipRow {
  membership_id: string
  platform_admin: boolean
  role_key: string | null
  profile_key: string | null
}

interface ExistingGroupGrantRow {
  id: string
  group_id: string
  group_name: string
  corporate_profile: CorporateProfile
  access_mode: 'all_companies' | 'selected_companies'
  can_view_consolidated: boolean
  permission_overrides: Record<string, unknown>
  status: 'active' | 'suspended'
  valid_from: Date
  valid_until: Date | null
  company_ids: string[] | null
}

interface ExistingCompanyGrantRow {
  id: string
  company_id: string
  company_name: string
  corporate_profile: CorporateProfile
  permission_overrides: Record<string, unknown>
  status: 'active' | 'suspended'
  valid_from: Date
  valid_until: Date | null
}

export async function getUserCorporateAccessConfiguration(
  actor: RequestPrincipal,
  targetUserId: string,
): Promise<CorporateAccessConfiguration> {
  const configuration = await withTenantTransaction(actor.tenantId, async (client) => {
    const target = await requireTargetMembership(client, actor.tenantId, targetUserId)
    assertActorCanManageTargetMembership(actor, target)
    return loadConfiguration(client, actor.tenantId, target.membership_id)
  })
  const scoped = scopeCorporateAccessConfigurationForActor(actor, configuration)
  if (
    !isTenantAccessAdministrator(actor)
    && configurationHasGrants(configuration)
    && !configurationHasGrants(scoped)
  ) {
    throw new CorporateAccessDeniedError('ACCESS_MANAGEMENT_DENIED', 'Usuario fora do seu escopo administrativo.')
  }
  return scoped
}

export async function replaceUserCorporateAccess(
  actor: RequestPrincipal,
  targetUserId: string,
  input: CorporateAccessConfigurationInput,
): Promise<CorporateAccessConfiguration> {
  assertActorCanChangeOwnCorporateAccess(actor, targetUserId)
  assertCorporateAccessDelegation(actor, input)

  return withTenantTransaction(actor.tenantId, async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1), hashtext($2))', [actor.tenantId, targetUserId])
    const target = await requireTargetMembership(client, actor.tenantId, targetUserId, true)
    if (target.platform_admin) {
      throw new CorporateAccessConflictError('O acesso do administrador da plataforma nao pode ser alterado nesta tela.')
    }
    assertActorCanManageTargetMembership(actor, target)
    return applyCorporateAccessConfigurationInTransaction(
      client,
      actor,
      target.membership_id,
      input,
    )
  })
}

export async function mergeUserCorporateAccess(
  actor: RequestPrincipal,
  targetUserId: string,
  input: CorporateAccessConfigurationInput,
  options: { preserveExistingDefault?: boolean } = {},
): Promise<CorporateAccessConfiguration> {
  assertActorCanChangeOwnCorporateAccess(actor, targetUserId)
  assertCorporateAccessDelegation(actor, input)

  return withTenantTransaction(actor.tenantId, async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1), hashtext($2))', [actor.tenantId, targetUserId])
    const target = await requireTargetMembership(client, actor.tenantId, targetUserId, true)
    if (target.platform_admin) {
      throw new CorporateAccessConflictError('O acesso do administrador da plataforma nao pode ser alterado nesta tela.')
    }
    assertActorCanManageTargetMembership(actor, target)
    const current = await loadConfiguration(client, actor.tenantId, target.membership_id)
    const visibleCurrent = scopeCorporateAccessConfigurationForActor(actor, current)
    const merged = mergeCorporateAccessConfigurations(visibleCurrent, input, options)
    assertCorporateAccessDelegation(actor, merged)
    return applyCorporateAccessConfigurationInTransaction(client, actor, target.membership_id, merged)
  })
}

export function mergeCorporateAccessConfigurations(
  current: CorporateAccessConfiguration,
  incoming: CorporateAccessConfigurationInput,
  options: { preserveExistingDefault?: boolean } = {},
): CorporateAccessConfigurationInput {
  const groupGrants = new Map<string, CorporateAccessConfigurationInput['groupGrants'][number]>(
    current.groupGrants.map((grant) => [grant.groupId, {
      groupId: grant.groupId,
      profile: grant.profile,
      accessMode: grant.accessMode,
      companyIds: grant.companyIds,
      canViewConsolidated: grant.canViewConsolidated,
      permissionOverrides: grant.permissionOverrides,
      status: grant.status,
      validFrom: grant.validFrom,
      validUntil: grant.validUntil,
    }]),
  )
  incoming.groupGrants.forEach((grant) => groupGrants.set(grant.groupId, grant))

  const companyGrants = new Map<string, CorporateAccessConfigurationInput['companyGrants'][number]>(
    current.companyGrants.map((grant) => [grant.companyId, {
      companyId: grant.companyId,
      profile: grant.profile,
      permissionOverrides: grant.permissionOverrides,
      status: grant.status,
      validFrom: grant.validFrom,
      validUntil: grant.validUntil,
    }]),
  )
  incoming.companyGrants.forEach((grant) => companyGrants.set(grant.companyId, grant))

  return {
    groupGrants: [...groupGrants.values()],
    companyGrants: [...companyGrants.values()],
    defaultContext: options.preserveExistingDefault && current.defaultContext
      ? current.defaultContext
      : incoming.defaultContext || current.defaultContext,
  }
}

export function scopeCorporateAccessConfigurationForActor(
  actor: RequestPrincipal,
  configuration: CorporateAccessConfiguration,
): CorporateAccessConfiguration {
  if (isTenantAccessAdministrator(actor)) return configuration
  const groupGrants = configuration.groupGrants.filter((grant) => actorCanManageGroupGrant(actor, grant))
  const companyGrants = configuration.companyGrants.filter((grant) => actorCanManageCompanyGrant(actor, grant))
  return {
    membershipId: configuration.membershipId,
    groupGrants,
    companyGrants,
    defaultContext: actorCanManageDefaultContext(actor, configuration.defaultContext)
      ? configuration.defaultContext
      : null,
  }
}

export async function requireCompleteCorporateAccessManagement(
  actor: RequestPrincipal,
  targetUserId: string,
): Promise<void> {
  if (isTenantAccessAdministrator(actor)) return
  await withTenantTransaction(actor.tenantId, async (client) => {
    const target = await requireTargetMembership(client, actor.tenantId, targetUserId)
    assertActorCanManageTargetMembership(actor, target)
    const configuration = await loadConfiguration(client, actor.tenantId, target.membership_id)
    if (!configurationHasGrants(configuration)) {
      throw new CorporateAccessDeniedError('ACCESS_MANAGEMENT_DENIED', 'Usuario fora do seu escopo administrativo.')
    }
    assertActorCanManageConfiguration(actor, configuration)
  })
}

function preservedCorporateAccessConfiguration(
  current: CorporateAccessConfiguration,
  editable: CorporateAccessConfiguration,
): CorporateAccessConfiguration {
  const editableGroupIds = new Set(editable.groupGrants.map((grant) => grant.id))
  const editableCompanyIds = new Set(editable.companyGrants.map((grant) => grant.id))
  return {
    membershipId: current.membershipId,
    groupGrants: current.groupGrants.filter((grant) => !editableGroupIds.has(grant.id)),
    companyGrants: current.companyGrants.filter((grant) => !editableCompanyIds.has(grant.id)),
    defaultContext: current.defaultContext,
  }
}

function combineCorporateAccessConfigurations(
  actor: RequestPrincipal,
  preserved: CorporateAccessConfiguration,
  incoming: CorporateAccessConfigurationInput,
  currentDefault: CorporateAccessConfiguration['defaultContext'],
): CorporateAccessConfigurationInput {
  const groupGrants = new Map<string, CorporateAccessConfigurationInput['groupGrants'][number]>()
  preserved.groupGrants.forEach((grant) => groupGrants.set(grant.groupId, groupGrantToInput(grant)))
  incoming.groupGrants.forEach((grant) => {
    if (groupGrants.has(grant.groupId)) {
      throw new CorporateAccessDeniedError(
        'GROUP_MANAGEMENT_DENIED',
        'Ja existe um vinculo superior ou fora do seu escopo para este grupo.',
      )
    }
    groupGrants.set(grant.groupId, grant)
  })

  const companyGrants = new Map<string, CorporateAccessConfigurationInput['companyGrants'][number]>()
  preserved.companyGrants.forEach((grant) => companyGrants.set(grant.companyId, companyGrantToInput(grant)))
  incoming.companyGrants.forEach((grant) => {
    if (companyGrants.has(grant.companyId)) {
      throw new CorporateAccessDeniedError(
        'COMPANY_MANAGEMENT_DENIED',
        'Ja existe um vinculo superior ou fora do seu escopo para esta empresa.',
      )
    }
    companyGrants.set(grant.companyId, grant)
  })

  return {
    groupGrants: [...groupGrants.values()],
    companyGrants: [...companyGrants.values()],
    defaultContext: currentDefault && !actorCanManageDefaultContext(actor, currentDefault)
      ? currentDefault
      : incoming.defaultContext,
  }
}

export function prepareCorporateAccessReplacement(
  actor: RequestPrincipal,
  current: CorporateAccessConfiguration,
  incoming: CorporateAccessConfigurationInput,
): {
  editableCurrent: CorporateAccessConfiguration
  effectiveInput: CorporateAccessConfigurationInput
} {
  const editableCurrent = scopeCorporateAccessConfigurationForActor(actor, current)
  const preserved = preservedCorporateAccessConfiguration(current, editableCurrent)
  return {
    editableCurrent,
    effectiveInput: combineCorporateAccessConfigurations(actor, preserved, incoming, current.defaultContext),
  }
}

function groupGrantToInput(
  grant: CorporateAccessConfiguration['groupGrants'][number],
): CorporateAccessConfigurationInput['groupGrants'][number] {
  return {
    groupId: grant.groupId,
    profile: grant.profile,
    accessMode: grant.accessMode,
    companyIds: grant.companyIds,
    canViewConsolidated: grant.canViewConsolidated,
    permissionOverrides: grant.permissionOverrides,
    status: grant.status,
    validFrom: grant.validFrom,
    validUntil: grant.validUntil,
  }
}

function companyGrantToInput(
  grant: CorporateAccessConfiguration['companyGrants'][number],
): CorporateAccessConfigurationInput['companyGrants'][number] {
  return {
    companyId: grant.companyId,
    profile: grant.profile,
    permissionOverrides: grant.permissionOverrides,
    status: grant.status,
    validFrom: grant.validFrom,
    validUntil: grant.validUntil,
  }
}

function actorCanManageGroupGrant(
  actor: RequestPrincipal,
  grant: CorporateAccessConfiguration['groupGrants'][number],
): boolean {
  try {
    assertCorporateAccessDelegation(actor, {
      groupGrants: [groupGrantToInput(grant)],
      companyGrants: [],
      defaultContext: null,
    })
    return true
  } catch (error) {
    if (error instanceof CorporateAccessDeniedError) return false
    throw error
  }
}

function actorCanManageCompanyGrant(
  actor: RequestPrincipal,
  grant: CorporateAccessConfiguration['companyGrants'][number],
): boolean {
  try {
    assertCorporateAccessDelegation(actor, {
      groupGrants: [],
      companyGrants: [companyGrantToInput(grant)],
      defaultContext: null,
    })
    return true
  } catch (error) {
    if (error instanceof CorporateAccessDeniedError) return false
    throw error
  }
}

function actorCanManageDefaultContext(
  actor: RequestPrincipal,
  context: CorporateAccessConfiguration['defaultContext'],
): boolean {
  if (!context || isTenantAccessAdministrator(actor)) return true
  if (context.type === 'company') {
    return Boolean(actor.corporateAccess?.companies.find(
      (company) => company.companyId === context.id
        && company.permissions.gerenciar_usuarios
        && company.permissions.gerenciar_vinculos_acesso,
    ))
  }
  const group = actor.corporateAccess?.groups.find((item) => item.groupId === context.id)
  return Boolean(group?.companyIds.some((companyId) => actor.corporateAccess?.companies.find(
    (company) => company.companyId === companyId
      && company.permissions.gerenciar_usuarios
      && company.permissions.gerenciar_vinculos_acesso,
  )))
}

function configurationHasGrants(configuration: CorporateAccessConfiguration): boolean {
  return configuration.groupGrants.length > 0 || configuration.companyGrants.length > 0
}

const INTERNAL_AGENCY_ROLE_KEYS = new Set([
  'tenant_admin',
  'financial_manager',
  'supervisor',
  'agent',
  'operator',
])

const INTERNAL_AGENCY_PROFILE_KEYS = new Set([
  'lider',
  'gestor_financeiro',
  'supervisor',
  'agente',
  'operacional',
])

const CORPORATE_MEMBERSHIP_ROLE_KEYS = new Set([
  'company_admin',
  'requester',
  'readonly',
])

function assertActorCanManageTargetMembership(
  actor: RequestPrincipal,
  target: TargetMembershipRow,
): void {
  if (isTenantAccessAdministrator(actor)) return
  const targetRoleKey = target.role_key?.trim() || ''
  if (CORPORATE_MEMBERSHIP_ROLE_KEYS.has(targetRoleKey)) return
  if (
    INTERNAL_AGENCY_ROLE_KEYS.has(targetRoleKey)
    || (target.profile_key && INTERNAL_AGENCY_PROFILE_KEYS.has(target.profile_key))
  ) {
    throw new CorporateAccessDeniedError(
      'INTERNAL_MEMBERSHIP_MANAGEMENT_DENIED',
      'Acessos internos da agencia exigem administracao completa do tenant.',
    )
  }
  throw new CorporateAccessDeniedError(
    'CORPORATE_MEMBERSHIP_ROLE_DENIED',
    'O perfil do usuario nao e reconhecido como um acesso corporativo administravel.',
  )
}

function assertActorCanChangeOwnCorporateAccess(
  actor: RequestPrincipal,
  targetUserId: string,
): void {
  if (actor.user.id !== targetUserId || isTenantAccessAdministrator(actor)) return
  throw new CorporateAccessDeniedError(
    'SELF_ACCESS_MANAGEMENT_DENIED',
    'Voce nao pode alterar o proprio escopo corporativo por esta tela.',
  )
}

function isTenantAccessAdministrator(actor: RequestPrincipal): boolean {
  if (actor.platformAdmin) return true
  if (!INTERNAL_AGENCY_ROLE_KEYS.has(actor.roleKey)) return false
  if (actor.roleKey !== 'tenant_admin' && actor.corporateAccess?.tenantWide !== true) return false
  return Boolean(
    actor.user.permissoes?.gerenciar_usuarios
    && actor.user.permissoes?.gerenciar_vinculos_acesso,
  )
}

export async function applyCorporateAccessConfigurationInTransaction(
  client: PoolClient,
  actor: RequestPrincipal,
  targetMembershipId: string,
  input: CorporateAccessConfigurationInput,
): Promise<CorporateAccessConfiguration> {
  const currentConfiguration = await loadConfiguration(client, actor.tenantId, targetMembershipId)
  assertCorporateAccessDelegation(actor, input)
  const { editableCurrent, effectiveInput } = prepareCorporateAccessReplacement(
    actor,
    currentConfiguration,
    input,
  )
  await validateDirectoryReferences(client, actor.tenantId, effectiveInput)

  const editableGroupGrantIds = editableCurrent.groupGrants.map((grant) => grant.id)
  const editableCompanyGrantIds = editableCurrent.companyGrants.map((grant) => grant.id)
  if (isTenantAccessAdministrator(actor)) {
    await client.query(
      `update corporate_group_access_grants
       set status = 'revoked', updated_at = now()
       where tenant_id = $1 and membership_id = $2 and status <> 'revoked'`,
      [actor.tenantId, targetMembershipId],
    )
    await client.query(
      `update corporate_company_access_grants
       set status = 'revoked', updated_at = now()
       where tenant_id = $1 and membership_id = $2 and status <> 'revoked'`,
      [actor.tenantId, targetMembershipId],
    )
  } else {
    if (editableGroupGrantIds.length) {
      await client.query(
        `update corporate_group_access_grants
         set status = 'revoked', updated_at = now()
         where tenant_id = $1 and membership_id = $2 and id = any($3::uuid[]) and status <> 'revoked'`,
        [actor.tenantId, targetMembershipId, editableGroupGrantIds],
      )
    }
    if (editableCompanyGrantIds.length) {
      await client.query(
        `update corporate_company_access_grants
         set status = 'revoked', updated_at = now()
         where tenant_id = $1 and membership_id = $2 and id = any($3::uuid[]) and status <> 'revoked'`,
        [actor.tenantId, targetMembershipId, editableCompanyGrantIds],
      )
    }
  }

  for (const grant of input.groupGrants) {
    const grantId = randomUUID()
    await client.query(
      `insert into corporate_group_access_grants (
         id, tenant_id, membership_id, business_group_id, corporate_profile,
         access_mode, can_view_consolidated, permission_overrides, status,
         valid_from, valid_until, created_by_membership_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, coalesce($10::timestamptz, now()), $11::timestamptz, $12)`,
      [
        grantId, actor.tenantId, targetMembershipId, grant.groupId, grant.profile,
        grant.accessMode, grant.canViewConsolidated,
        JSON.stringify(permissionOverridesOnly(grant.permissionOverrides)), grant.status,
        grant.validFrom || null, grant.validUntil || null, actor.membershipId,
      ],
    )
    if (grant.accessMode === 'selected_companies') {
      for (const companyId of uniqueStrings(grant.companyIds)) {
        await client.query(
          `insert into corporate_group_access_companies (
             tenant_id, group_access_grant_id, company_id
           ) values ($1, $2, $3)`,
          [actor.tenantId, grantId, companyId],
        )
      }
    }
  }

  for (const grant of input.companyGrants) {
    await client.query(
      `insert into corporate_company_access_grants (
         id, tenant_id, membership_id, company_id, corporate_profile,
         permission_overrides, status, valid_from, valid_until, created_by_membership_id
       ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, coalesce($8::timestamptz, now()), $9::timestamptz, $10)`,
      [
        randomUUID(), actor.tenantId, targetMembershipId, grant.companyId, grant.profile,
        JSON.stringify(permissionOverridesOnly(grant.permissionOverrides)), grant.status,
        grant.validFrom || null, grant.validUntil || null, actor.membershipId,
      ],
    )
  }

  await replacePreference(client, actor.tenantId, targetMembershipId, effectiveInput.defaultContext)
  await updateLegacyScope(client, actor.tenantId, targetMembershipId, effectiveInput)
  return scopeCorporateAccessConfigurationForActor(
    actor,
    await loadConfiguration(client, actor.tenantId, targetMembershipId),
  )
}

export async function setOwnCorporateDefaultContext(
  principal: RequestPrincipal,
  context: { type: 'company' | 'group'; id: string } | null,
): Promise<void> {
  if (context) await resolveCorporateContext(principal, context)
  await withTenantTransaction(principal.tenantId, async (client) => {
    await replacePreference(client, principal.tenantId, principal.membershipId, context)
  })
}

async function requireTargetMembership(
  client: PoolClient,
  tenantId: string,
  targetUserId: string,
  lock = false,
): Promise<TargetMembershipRow> {
  const result = await client.query<TargetMembershipRow>(
    `select membership.id as membership_id, user_row.platform_admin,
            role_row.role_key, membership.profile_key
     from tenant_memberships membership
     join users user_row on user_row.id = membership.user_id
     join roles role_row
       on role_row.id = membership.role_id
      and (role_row.tenant_id = membership.tenant_id or role_row.tenant_id is null)
     where membership.tenant_id = $1 and membership.user_id = $2
       and user_row.deleted_at is null
     ${lock ? 'for update of membership' : ''}`,
    [tenantId, targetUserId],
  )
  if (!result.rows[0]) throw new CorporateAccessNotFoundError('Usuario nao encontrado neste tenant.')
  return result.rows[0]
}

async function loadConfiguration(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
): Promise<CorporateAccessConfiguration> {
  const groupResult = await client.query<ExistingGroupGrantRow>(
      `select grant_row.id, grant_row.business_group_id as group_id, group_row.name as group_name,
              grant_row.corporate_profile, grant_row.access_mode, grant_row.can_view_consolidated,
              grant_row.permission_overrides, grant_row.status, grant_row.valid_from, grant_row.valid_until,
              coalesce(array_agg(selected.company_id) filter (where selected.company_id is not null), '{}') as company_ids
       from corporate_group_access_grants grant_row
       join business_groups group_row
         on group_row.tenant_id = grant_row.tenant_id and group_row.id = grant_row.business_group_id
       left join corporate_group_access_companies selected
         on selected.tenant_id = grant_row.tenant_id and selected.group_access_grant_id = grant_row.id
       where grant_row.tenant_id = $1 and grant_row.membership_id = $2 and grant_row.status <> 'revoked'
       group by grant_row.id, group_row.name
       order by group_row.name`,
      [tenantId, membershipId],
    )
  const companyResult = await client.query<ExistingCompanyGrantRow>(
      `select grant_row.id, grant_row.company_id,
              coalesce(company_row.trade_name, company_row.legal_name) as company_name,
              grant_row.corporate_profile, grant_row.permission_overrides,
              grant_row.status, grant_row.valid_from, grant_row.valid_until
       from corporate_company_access_grants grant_row
       join companies company_row
         on company_row.tenant_id = grant_row.tenant_id and company_row.id = grant_row.company_id
       where grant_row.tenant_id = $1 and grant_row.membership_id = $2 and grant_row.status <> 'revoked'
       order by coalesce(company_row.trade_name, company_row.legal_name)`,
      [tenantId, membershipId],
    )
  const preferenceResult = await client.query<{ default_context_type: 'company' | 'group' | null; default_company_id: string | null; default_group_id: string | null }>(
      `select default_context_type, default_company_id, default_group_id
       from membership_corporate_preferences
       where tenant_id = $1 and membership_id = $2`,
      [tenantId, membershipId],
    )
  const preference = preferenceResult.rows[0]
  return {
    membershipId,
    groupGrants: groupResult.rows.map((grant) => ({
      id: grant.id,
      groupId: grant.group_id,
      groupName: grant.group_name,
      profile: grant.corporate_profile,
      accessMode: grant.access_mode,
      companyIds: grant.company_ids || [],
      canViewConsolidated: grant.can_view_consolidated,
      permissionOverrides: permissionOverridesOnly(grant.permission_overrides),
      status: grant.status,
      validFrom: grant.valid_from.toISOString(),
      validUntil: grant.valid_until?.toISOString() || null,
    })),
    companyGrants: companyResult.rows.map((grant) => ({
      id: grant.id,
      companyId: grant.company_id,
      companyName: grant.company_name,
      profile: grant.corporate_profile,
      permissionOverrides: permissionOverridesOnly(grant.permission_overrides),
      status: grant.status,
      validFrom: grant.valid_from.toISOString(),
      validUntil: grant.valid_until?.toISOString() || null,
    })),
    defaultContext: preference?.default_context_type === 'company' && preference.default_company_id
      ? { type: 'company', id: preference.default_company_id }
      : preference?.default_context_type === 'group' && preference.default_group_id
        ? { type: 'group', id: preference.default_group_id }
        : null,
  }
}

async function validateDirectoryReferences(
  client: PoolClient,
  tenantId: string,
  input: CorporateAccessConfigurationInput,
): Promise<void> {
  const groupIds = uniqueStrings(input.groupGrants.map((grant) => grant.groupId))
  const directCompanyIds = uniqueStrings(input.companyGrants.map((grant) => grant.companyId))
  const selectedCompanyIds = uniqueStrings(input.groupGrants.flatMap((grant) => grant.companyIds))
  const defaultCompanyId = input.defaultContext?.type === 'company' ? input.defaultContext.id : null
  const allCompanyIds = uniqueStrings([...directCompanyIds, ...selectedCompanyIds, defaultCompanyId || ''])
  const companyGroup = new Map<string, string | null>()
  const activeCompaniesByGroup = new Map<string, Set<string>>()

  if (groupIds.length) {
    const groups = await client.query<{ id: string }>(
      `select id from business_groups
       where tenant_id = $1 and id = any($2::text[]) and status = 'active' and deleted_at is null
       for share`,
      [tenantId, groupIds],
    )
    if (groups.rowCount !== groupIds.length) throw new CorporateAccessConflictError('Um ou mais grupos sao invalidos ou inativos.')
    const groupCompanies = await client.query<{ id: string; group_id: string }>(
      `select id, group_id from companies
       where tenant_id = $1 and group_id = any($2::text[])
         and status = 'active' and deleted_at is null
       for share`,
      [tenantId, groupIds],
    )
    groupCompanies.rows.forEach((company) => {
      const ids = activeCompaniesByGroup.get(company.group_id) || new Set<string>()
      ids.add(company.id)
      activeCompaniesByGroup.set(company.group_id, ids)
      companyGroup.set(company.id, company.group_id)
    })
  }
  if (allCompanyIds.length) {
    const companies = await client.query<{ id: string; group_id: string | null }>(
      `select id, group_id from companies
       where tenant_id = $1 and id = any($2::text[]) and status = 'active' and deleted_at is null
       for share`,
      [tenantId, allCompanyIds],
    )
    if (companies.rowCount !== allCompanyIds.length) throw new CorporateAccessConflictError('Uma ou mais empresas sao invalidas ou inativas.')
    companies.rows.forEach((company) => companyGroup.set(company.id, company.group_id))
    input.groupGrants.forEach((grant) => grant.companyIds.forEach((companyId) => {
      if (companyGroup.get(companyId) !== grant.groupId) {
        throw new CorporateAccessConflictError('Empresa selecionada nao pertence ao grupo informado.')
      }
    }))
  }

  if (input.defaultContext?.type === 'group') {
    const defaultGrant = input.groupGrants.find((grant) => grant.groupId === input.defaultContext?.id)
    const groupCompanyIds = defaultGrant?.accessMode === 'selected_companies'
      ? defaultGrant.companyIds.filter((companyId) => activeCompaniesByGroup.get(defaultGrant.groupId)?.has(companyId))
      : [...(activeCompaniesByGroup.get(defaultGrant?.groupId || '') || [])]
    const canView = defaultGrant
      ? permissionsForCorporateProfile(defaultGrant.profile, defaultGrant.permissionOverrides).ver_consolidado_grupo
      : false
    if (!defaultGrant || !defaultGrant.canViewConsolidated || !canView || !groupCompanyIds.length || !grantIsEffectiveNow(defaultGrant)) {
      throw new CorporateAccessConflictError('O grupo padrao precisa ter visao consolidada ativa.')
    }
  }
  if (defaultCompanyId) {
    const direct = input.companyGrants.some((grant) => (
      grant.companyId === defaultCompanyId && grantIsEffectiveNow(grant)
      && permissionsForCorporateProfile(grant.profile, grant.permissionOverrides).ver_empresas
    ))
    const inherited = input.groupGrants.some((grant) => (
      grantIsEffectiveNow(grant)
      && companyGroup.get(defaultCompanyId) === grant.groupId
      && (grant.accessMode === 'all_companies' || grant.companyIds.includes(defaultCompanyId))
      && permissionsForCorporateProfile(grant.profile, grant.permissionOverrides).ver_empresas
    ))
    if (!direct && !inherited) {
      throw new CorporateAccessConflictError('A empresa padrao precisa pertencer ao escopo ativo.')
    }
  }
}

async function replacePreference(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
  context: { type: 'company' | 'group'; id: string } | null,
): Promise<void> {
  await client.query(
    `insert into membership_corporate_preferences (
       tenant_id, membership_id, default_context_type, default_company_id, default_group_id
     ) values ($1, $2, $3, $4, $5)
     on conflict (tenant_id, membership_id) do update set
       default_context_type = excluded.default_context_type,
       default_company_id = excluded.default_company_id,
       default_group_id = excluded.default_group_id`,
    [
      tenantId,
      membershipId,
      context?.type || null,
      context?.type === 'company' ? context.id : null,
      context?.type === 'group' ? context.id : null,
    ],
  )
}

async function updateLegacyScope(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
  input: CorporateAccessConfigurationInput,
): Promise<void> {
  const activeGroupGrants = input.groupGrants.filter(grantIsEffectiveNow)
  const allGroupIds = activeGroupGrants
    .filter((grant) => grant.accessMode === 'all_companies')
    .map((grant) => grant.groupId)
  const selectedCompanyIds = activeGroupGrants.flatMap((grant) => grant.companyIds)
  const allModeCompanyResult = allGroupIds.length
    ? await client.query<{ id: string }>(
        `select id from companies
         where tenant_id = $1 and group_id = any($2::text[])
           and status = 'active' and deleted_at is null`,
        [tenantId, allGroupIds],
      )
    : { rows: [] as Array<{ id: string }> }
  const directCompanyIds = input.companyGrants
    .filter(grantIsEffectiveNow)
    .map((grant) => grant.companyId)
  const companyIds = uniqueStrings([
    ...directCompanyIds,
    ...selectedCompanyIds,
    ...allModeCompanyResult.rows.map((company) => company.id),
  ])
  const defaultCompanyId = input.defaultContext?.type === 'company'
    ? input.defaultContext.id
    : companyIds[0] || null
  await client.query(
    `update tenant_memberships set
       company_id = $3,
       allowed_company_ids = $4::text[],
       allowed_group_ids = $5::text[]
     where tenant_id = $1 and id = $2`,
    [tenantId, membershipId, defaultCompanyId, companyIds, uniqueStrings(allGroupIds)],
  )
}

function grantIsEffectiveNow(grant: {
  status: 'active' | 'suspended'
  validFrom?: string | null
  validUntil?: string | null
}): boolean {
  if (grant.status !== 'active') return false
  const now = Date.now()
  if (grant.validFrom && new Date(grant.validFrom).getTime() > now) return false
  return !grant.validUntil || new Date(grant.validUntil).getTime() > now
}

function assertActorCanManageConfiguration(
  actor: RequestPrincipal,
  configuration: CorporateAccessConfiguration,
): void {
  assertCorporateAccessDelegation(actor, {
    groupGrants: configuration.groupGrants.map((grant) => ({
      groupId: grant.groupId,
      profile: grant.profile,
      accessMode: grant.accessMode,
      companyIds: grant.companyIds,
      canViewConsolidated: grant.canViewConsolidated,
      permissionOverrides: grant.permissionOverrides,
      status: grant.status,
      validFrom: grant.validFrom,
      validUntil: grant.validUntil,
    })),
    companyGrants: configuration.companyGrants.map((grant) => ({
      companyId: grant.companyId,
      profile: grant.profile,
      permissionOverrides: grant.permissionOverrides,
      status: grant.status,
      validFrom: grant.validFrom,
      validUntil: grant.validUntil,
    })),
    defaultContext: configuration.defaultContext,
  })
}

export function assertCorporateAccessDelegation(
  actor: RequestPrincipal,
  input: CorporateAccessConfigurationInput,
  options: { requireAtLeastOneGrant?: boolean } = {},
): void {
  if (isTenantAccessAdministrator(actor)) return
  const access = actor.corporateAccess
  if (!access) throw new CorporateAccessDeniedError('ACCESS_MANAGEMENT_DENIED', 'Escopo corporativo indisponivel.')
  if (options.requireAtLeastOneGrant && input.groupGrants.length === 0 && input.companyGrants.length === 0) {
    throw new CorporateAccessDeniedError(
      'ACCESS_SCOPE_REQUIRED',
      'A criacao delegada exige ao menos um grupo ou empresa autorizada.',
    )
  }

  for (const grant of input.groupGrants) {
    const actorGroup = access.groups.find((group) => group.groupId === grant.groupId)
    if (!actorGroup) throw new CorporateAccessDeniedError('GROUP_MANAGEMENT_DENIED', 'Grupo fora do seu escopo administrativo.')
    if (grant.accessMode === 'all_companies' && !actorGroup.accessModes.includes('all_companies')) {
      throw new CorporateAccessDeniedError('GROUP_MANAGEMENT_DENIED', 'Voce nao pode conceder empresas futuras deste grupo.')
    }
    if (grant.canViewConsolidated && !actorGroup.canViewConsolidated) {
      throw new CorporateAccessDeniedError('GROUP_MANAGEMENT_DENIED', 'Voce nao pode conceder visao consolidada deste grupo.')
    }
    if (!actorGroup.companyIds.length) {
      throw new CorporateAccessDeniedError('GROUP_MANAGEMENT_DENIED', 'O grupo ainda nao possui empresa dentro do seu escopo administrativo.')
    }
    if (grant.companyIds.some((companyId) => !actorGroup.companyIds.includes(companyId))) {
      throw new CorporateAccessDeniedError('COMPANY_MANAGEMENT_DENIED', 'Empresa fora do seu escopo administrativo.')
    }
    const authority = actorGroup.delegationAuthorities?.find((candidate) => (
      candidate.source === 'group'
      && (grant.accessMode !== 'all_companies' || candidate.accessMode === 'all_companies')
      && (!grant.canViewConsolidated || candidate.canViewConsolidated)
      && grant.companyIds.every((companyId) => candidate.companyIds.includes(companyId))
      && authorityCanDelegate(candidate.permissions, grant.profile, grant.permissionOverrides)
    ))
    if (!authority) {
      throw new CorporateAccessDeniedError(
        'PRIVILEGE_ESCALATION_DENIED',
        'O vinculo de grupo informado nao pode conceder este perfil ou escopo.',
      )
    }
  }
  input.companyGrants.forEach((grant) => {
    assertActorCanGrantCompany(actor, grant.companyId, grant.profile, grant.permissionOverrides)
  })
}

function assertActorCanGrantCompany(
  actor: RequestPrincipal,
  companyId: string,
  profile: CorporateProfile,
  overrides: Record<string, unknown>,
): void {
  const actorCompany = actor.corporateAccess?.companies.find((company) => company.companyId === companyId)
  if (!actorCompany) {
    throw new CorporateAccessDeniedError('COMPANY_MANAGEMENT_DENIED', 'Empresa fora do seu escopo administrativo.')
  }
  const scopedAuthorities = (actorCompany.delegationAuthorities || [])
    .filter((authority) => authority.companyIds.includes(companyId))
  if (!scopedAuthorities.length) {
    throw new CorporateAccessDeniedError('COMPANY_MANAGEMENT_DENIED', 'Empresa fora do seu escopo administrativo.')
  }
  const hasSingleSourceAuthority = scopedAuthorities
    .some((authority) => authorityCanDelegate(authority.permissions, profile, overrides))
  if (!hasSingleSourceAuthority) {
    throw new CorporateAccessDeniedError('PRIVILEGE_ESCALATION_DENIED', 'Nao e permitido conceder permissoes superiores as suas.')
  }
}

function authorityCanDelegate(
  authority: Permissoes,
  profile: CorporateProfile,
  overrides: Record<string, unknown>,
): boolean {
  if (!authority.gerenciar_usuarios || !authority.gerenciar_vinculos_acesso) return false
  const requested = permissionsForCorporateProfile(profile, overrides)
  return !(Object.keys(requested) as Array<keyof Permissoes>)
    .some((permission) => requested[permission] && !authority[permission])
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

export class CorporateAccessConflictError extends Error {}
export class CorporateAccessNotFoundError extends Error {}
