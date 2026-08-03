import 'server-only'

import type { PoolClient } from 'pg'

import {
  mergePermissions,
  permissionsForCorporateProfile,
} from '@/lib/corporate-access'
import { withTenantTransaction } from '@/lib/server/database'
import type { RequestPrincipal } from '@/lib/server/request-context'
import {
  PERMISSOES_PADRAO_POR_PERFIL,
  type CorporateAccessMode,
  type CorporateAccessSummary,
  type CorporateCompanyAccessSummary,
  type CorporateContextOption,
  type CorporateDelegationAuthority,
  type CorporateGroupAccessSummary,
  type CorporateProfile,
  type Permissoes,
} from '@/types'

export interface CorporateAccessCompanyRow {
  id: string
  name: string
  group_id: string | null
  group_name: string | null
}

export interface CorporateAccessGroupRow {
  id: string
  name: string
}

export interface CorporateAccessGroupGrantRow {
  id: string
  business_group_id: string
  corporate_profile: CorporateProfile
  access_mode: CorporateAccessMode
  can_view_consolidated: boolean
  permission_overrides: Record<string, unknown>
  selected_company_ids: string[] | null
}

export interface CorporateAccessCompanyGrantRow {
  id: string
  company_id: string
  corporate_profile: CorporateProfile
  permission_overrides: Record<string, unknown>
}

export interface CorporateAccessPreferenceRow {
  default_context_type: 'company' | 'group' | null
  default_company_id: string | null
  default_group_id: string | null
}

interface MembershipScopeRow {
  membership_id: string
  role_key: string
  profile_key: string | null
  platform_admin: boolean
  company_id: string | null
  allowed_company_ids: string[] | null
  allowed_group_ids: string[] | null
  permissions: Record<string, unknown> | null
}

export interface ResolveCorporateAccessInput {
  tenantId: string
  membershipId: string
  roleKey: string
  platformAdmin: boolean
  membershipPermissions: Permissoes
  legacyCompanyId?: string | null
  legacyCompanyIds?: string[]
  legacyGroupIds?: string[]
}

export interface ResolvedCorporateAccess {
  summary: CorporateAccessSummary
  effectivePermissions: Permissoes
  primaryProfile: CorporateProfile | null
}

export interface ResolvedCorporateContext {
  type: 'company' | 'group'
  id: string
  companyIds: string[]
  groupId: string | null
}

const LEGACY_TENANT_WIDE_ROLES = new Set([
  'agent',
  'financial_manager',
  'supervisor',
  'operator',
])

export async function getEffectiveCompanyAccess(userId: string, tenantId: string): Promise<CorporateAccessSummary> {
  const membership = await loadMembershipScope(userId, tenantId)
  if (!membership) throw new CorporateAccessDeniedError('MEMBERSHIP_NOT_FOUND', 'Vinculo do usuario nao encontrado.')
  const membershipPermissions = normalizeMembershipPermissions(membership.permissions, membership.profile_key)
  return (await resolveEffectiveCorporateAccess({
    tenantId,
    membershipId: membership.membership_id,
    roleKey: membership.role_key,
    platformAdmin: membership.platform_admin,
    membershipPermissions,
    legacyCompanyId: membership.company_id,
    legacyCompanyIds: membership.allowed_company_ids || [],
    legacyGroupIds: membership.allowed_group_ids || [],
  })).summary
}

export async function getEffectiveGroupAccess(userId: string, tenantId: string): Promise<CorporateGroupAccessSummary[]> {
  return (await getEffectiveCompanyAccess(userId, tenantId)).groups
}

export async function hydratePrincipalCorporateAccess(principal: RequestPrincipal): Promise<RequestPrincipal> {
  const resolved = await resolveEffectiveCorporateAccess({
    tenantId: principal.tenantId,
    membershipId: principal.membershipId,
    roleKey: principal.roleKey,
    platformAdmin: principal.platformAdmin,
    membershipPermissions: principal.user.permissoes || PERMISSOES_PADRAO_POR_PERFIL.operacional,
    legacyCompanyId: principal.user.company_id,
    legacyCompanyIds: principal.user.empresa_ids || [],
    legacyGroupIds: principal.user.grupo_ids || [],
  })
  const defaultCompanyId = resolved.summary.defaultContext?.type === 'company'
    ? resolved.summary.defaultContext.id
    : resolved.summary.companyIds[0] || null

  return {
    ...principal,
    corporateAccess: resolved.summary,
    user: {
      ...principal.user,
      role: resolved.primaryProfile && ['owner', 'group_admin', 'company_admin'].includes(resolved.primaryProfile)
        ? 'company_admin'
        : principal.user.role,
      company_id: defaultCompanyId,
      empresa_ids: resolved.summary.companyIds,
      grupo_ids: resolved.summary.groupIds,
      corporate_profile: resolved.primaryProfile || undefined,
      corporate_access: resolved.summary,
      permissoes: resolved.effectivePermissions,
    },
  }
}

export async function resolveEffectiveCorporateAccess(
  input: ResolveCorporateAccessInput,
): Promise<ResolvedCorporateAccess> {
  return withTenantTransaction(input.tenantId, (client) => resolveEffectiveCorporateAccessInTransaction(client, input))
}

export async function resolveEffectiveCorporateAccessInTransaction(
  client: PoolClient,
  input: ResolveCorporateAccessInput,
): Promise<ResolvedCorporateAccess> {
  const companies = await loadCompanies(client, input.tenantId)
  const groups = await loadGroups(client, input.tenantId)
  const groupGrants = await loadGroupGrants(client, input.tenantId, input.membershipId)
  const companyGrants = await loadCompanyGrants(client, input.tenantId, input.membershipId)
  const preference = await loadPreference(client, input.tenantId, input.membershipId)
  const hasCorporateConfiguration = await hasCorporateAccessConfiguration(
    client,
    input.tenantId,
    input.membershipId,
  )
  return calculateCorporateAccess(
    input,
    companies,
    groups,
    groupGrants,
    companyGrants,
    preference,
    hasCorporateConfiguration,
  )
}

export function getAccessibleCompanyIds(principal: RequestPrincipal): string[] {
  return [...(principal.corporateAccess?.companyIds || principal.user.empresa_ids || [])]
}

export function getAccessibleGroupIds(principal: RequestPrincipal): string[] {
  return [...(principal.corporateAccess?.groupIds || principal.user.grupo_ids || [])]
}

export function canViewConsolidatedGroup(principal: RequestPrincipal, groupId: string): boolean {
  return Boolean(principal.corporateAccess?.contexts.some(
    (context) => context.type === 'group' && context.id === groupId && context.companyIds.length > 0,
  ))
}

export async function requireCompanyAccess(
  principal: RequestPrincipal,
  companyId: string,
  permission?: keyof Permissoes,
): Promise<CorporateCompanyAccessSummary> {
  const access = principal.corporateAccess?.companies.find((company) => company.companyId === companyId)
  if (!access) {
    throw new CorporateAccessDeniedError('COMPANY_ACCESS_DENIED', 'Empresa fora do escopo autorizado.')
  }
  if (permission && !access.permissions[permission]) {
    throw new CorporateAccessDeniedError('COMPANY_PERMISSION_DENIED', 'Permissao insuficiente para esta empresa.')
  }
  return access
}

export async function requireGroupAccess(
  principal: RequestPrincipal,
  groupId: string,
  permission?: keyof Permissoes,
): Promise<CorporateGroupAccessSummary> {
  const access = principal.corporateAccess?.groups.find((group) => group.groupId === groupId)
  if (!access || !access.companyIds.length) {
    throw new CorporateAccessDeniedError('GROUP_ACCESS_DENIED', 'Grupo fora do escopo autorizado.')
  }
  if (permission) {
    const companyIds = access.companyIds.filter((companyId) => (
      principal.corporateAccess?.companies.find((company) => company.companyId === companyId)?.permissions[permission]
    ))
    if (!companyIds.length) {
      throw new CorporateAccessDeniedError('GROUP_PERMISSION_DENIED', 'Permissao insuficiente para este grupo.')
    }
    return { ...access, companyIds }
  }
  return access
}

export async function requireCompanySelectionAccess(
  principal: RequestPrincipal,
  requestedCompanyIds: readonly string[],
  permission?: keyof Permissoes,
): Promise<string[]> {
  const companyIds = [...new Set(requestedCompanyIds.map((companyId) => companyId.trim()).filter(Boolean))]
  if (companyIds.length === 0) return []

  const companies = await Promise.all(companyIds.map((companyId) => (
    requireCompanyAccess(principal, companyId, permission)
  )))
  return companies.map((company) => company.companyId)
}

export async function resolveCorporateContext(
  principal: RequestPrincipal,
  requested?: { type: 'company' | 'group'; id: string } | null,
): Promise<ResolvedCorporateContext | null> {
  const summary = principal.corporateAccess
  if (!summary) return null
  const selected = requested || summary.defaultContext
  if (!selected) return null

  if (selected.type === 'company') {
    const company = await requireCompanyAccess(principal, selected.id, 'ver_empresas')
    return { type: 'company', id: company.companyId, companyIds: [company.companyId], groupId: company.groupId }
  }

  const group = await requireGroupAccess(principal, selected.id, 'ver_consolidado_grupo')
  if (!group.canViewConsolidated) {
    throw new CorporateAccessDeniedError('CONSOLIDATED_ACCESS_DENIED', 'Visao consolidada nao autorizada.')
  }
  return { type: 'group', id: group.groupId, companyIds: [...group.companyIds], groupId: group.groupId }
}

export class CorporateAccessDeniedError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
  }
}

export function calculateCorporateAccess(
  input: ResolveCorporateAccessInput,
  companies: CorporateAccessCompanyRow[],
  groups: CorporateAccessGroupRow[],
  groupGrants: CorporateAccessGroupGrantRow[],
  companyGrants: CorporateAccessCompanyGrantRow[],
  preference: CorporateAccessPreferenceRow | null,
  hasCorporateConfiguration: boolean,
): ResolvedCorporateAccess {
  const companyById = new Map(companies.map((company) => [company.id, company]))
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const companiesByGroup = new Map<string, CorporateAccessCompanyRow[]>()
  companies.forEach((company) => {
    if (!company.group_id) return
    companiesByGroup.set(company.group_id, [...(companiesByGroup.get(company.group_id) || []), company])
  })

  const noExplicitScope = !hasCorporateConfiguration &&
    !input.legacyCompanyId && !(input.legacyCompanyIds || []).length && !(input.legacyGroupIds || []).length
  const tenantWide = input.platformAdmin || input.roleKey === 'tenant_admin' ||
    (noExplicitScope && LEGACY_TENANT_WIDE_ROLES.has(input.roleKey))
  const companyAccess = new Map<string, MutableCompanyAccess>()
  const groupAccess = new Map<string, MutableGroupAccess>()

  if (tenantWide) {
    const source = input.platformAdmin || input.roleKey === 'tenant_admin' ? 'tenant_admin' : 'legacy_unscoped'
    const profile = legacyProfile(input.roleKey)
    companies.forEach((company) => addCompanyAccess(companyAccess, company, source, profile, input.membershipPermissions))
    groups.forEach((group) => addGroupAccess(
      groupAccess,
      group,
      (companiesByGroup.get(group.id) || []).map((company) => company.id),
      true,
      'all_companies',
      profile,
    ))
  } else {
    for (const grant of groupGrants) {
      const group = groupById.get(grant.business_group_id)
      if (!group) continue
      const candidates = grant.access_mode === 'all_companies'
        ? companiesByGroup.get(group.id) || []
        : (grant.selected_company_ids || []).flatMap((id) => {
            const company = companyById.get(id)
            return company?.group_id === group.id ? [company] : []
          })
      const grantPermissions = permissionsForCorporateProfile(grant.corporate_profile, grant.permission_overrides)
      const delegationAuthority: CorporateDelegationAuthority = {
        sourceId: grant.id,
        source: 'group',
        profile: grant.corporate_profile,
        permissions: grantPermissions,
        companyIds: candidates.map((company) => company.id),
        accessMode: grant.access_mode,
        canViewConsolidated: grant.can_view_consolidated,
      }
      candidates.forEach((company) => addCompanyAccess(
        companyAccess,
        company,
        grant.access_mode === 'all_companies' ? 'group_all' : 'group_selected',
        grant.corporate_profile,
        grantPermissions,
        delegationAuthority,
      ))
      addGroupAccess(
        groupAccess,
        group,
        candidates.map((company) => company.id),
        grant.can_view_consolidated,
        grant.access_mode,
        grant.corporate_profile,
        delegationAuthority,
      )
    }

    for (const grant of companyGrants) {
      const company = companyById.get(grant.company_id)
      if (!company) continue
      const grantPermissions = permissionsForCorporateProfile(grant.corporate_profile, grant.permission_overrides)
      addCompanyAccess(
        companyAccess,
        company,
        'direct',
        grant.corporate_profile,
        grantPermissions,
        {
          sourceId: grant.id,
          source: 'company',
          profile: grant.corporate_profile,
          permissions: grantPermissions,
          companyIds: [company.id],
          accessMode: null,
          canViewConsolidated: false,
        },
      )
    }

    // Legacy arrays remain a compatibility bridge only until the membership has
    // any relational corporate grant. Otherwise an expired or revoked grant could
    // be unintentionally restored by stale legacy scope values.
    if (!hasCorporateConfiguration) {
      const legacyProfileValue = legacyProfile(input.roleKey)
      const legacyCompanyIds = uniqueStrings([input.legacyCompanyId || '', ...(input.legacyCompanyIds || [])])
      legacyCompanyIds.forEach((companyId) => {
        const company = companyById.get(companyId)
        if (company) addCompanyAccess(companyAccess, company, 'direct', legacyProfileValue, input.membershipPermissions)
      })
      uniqueStrings(input.legacyGroupIds || []).forEach((groupId) => {
        const group = groupById.get(groupId)
        if (!group) return
        const groupCompanies = companiesByGroup.get(groupId) || []
        groupCompanies.forEach((company) => addCompanyAccess(
          companyAccess,
          company,
          'group_all',
          legacyProfileValue,
          input.membershipPermissions,
        ))
        addGroupAccess(
          groupAccess,
          group,
          groupCompanies.map((company) => company.id),
          true,
          'all_companies',
          legacyProfileValue,
        )
      })
    }
  }

  const companySummaries = [...companyAccess.values()]
    .map(finalizeCompanyAccess)
    .sort((left, right) => left.companyName.localeCompare(right.companyName, 'pt-BR'))
  const groupSummaries = [...groupAccess.values()]
    .map(finalizeGroupAccess)
    .filter((group) => group.companyIds.length > 0)
    .sort((left, right) => left.groupName.localeCompare(right.groupName, 'pt-BR'))
  const contexts = createContexts(companySummaries, groupSummaries)
  const defaultContext = selectDefaultContext(preference, contexts, groupGrants)
  const grantProfiles = uniqueProfiles([
    ...groupGrants.map((grant) => grant.corporate_profile),
    ...companyGrants.map((grant) => grant.corporate_profile),
  ])
  const effectivePermissions = tenantWide
    ? { ...input.membershipPermissions }
    : mergePermissions(companySummaries.map((company) => company.permissions))

  return {
    summary: {
      tenantWide,
      companyIds: companySummaries.map((company) => company.companyId),
      groupIds: groupSummaries.map((group) => group.groupId),
      companies: companySummaries,
      groups: groupSummaries,
      contexts,
      defaultContext,
      refreshedAt: new Date().toISOString(),
    },
    effectivePermissions,
    primaryProfile: grantProfiles[0] || (tenantWide ? legacyProfile(input.roleKey) : null),
  }
}

interface MutableCompanyAccess extends Omit<CorporateCompanyAccessSummary, 'sources' | 'profiles' | 'permissions' | 'delegationAuthorities'> {
  sources: Set<CorporateCompanyAccessSummary['sources'][number]>
  profiles: Set<CorporateProfile>
  permissionSets: Permissoes[]
  delegationAuthorities: CorporateDelegationAuthority[]
}

interface MutableGroupAccess extends Omit<CorporateGroupAccessSummary, 'companyIds' | 'accessModes' | 'profiles' | 'delegationAuthorities'> {
  companyIds: Set<string>
  accessModes: Set<CorporateAccessMode>
  profiles: Set<CorporateProfile>
  delegationAuthorities: CorporateDelegationAuthority[]
}

function addCompanyAccess(
  target: Map<string, MutableCompanyAccess>,
  company: CorporateAccessCompanyRow,
  source: CorporateCompanyAccessSummary['sources'][number],
  profile: CorporateProfile,
  permissions: Permissoes,
  delegationAuthority?: CorporateDelegationAuthority,
): void {
  const current = target.get(company.id) || {
    companyId: company.id,
    companyName: company.name,
    groupId: company.group_id,
    groupName: company.group_name,
    sources: new Set(),
    profiles: new Set(),
    permissionSets: [],
    delegationAuthorities: [],
  }
  current.sources.add(source)
  current.profiles.add(profile)
  current.permissionSets.push(permissions)
  if (delegationAuthority && !current.delegationAuthorities.some((item) => item.sourceId === delegationAuthority.sourceId)) {
    current.delegationAuthorities.push(delegationAuthority)
  }
  target.set(company.id, current)
}

function addGroupAccess(
  target: Map<string, MutableGroupAccess>,
  group: CorporateAccessGroupRow,
  companyIds: string[],
  canViewConsolidated: boolean,
  mode: CorporateAccessMode,
  profile: CorporateProfile,
  delegationAuthority?: CorporateDelegationAuthority,
): void {
  const current = target.get(group.id) || {
    groupId: group.id,
    groupName: group.name,
    companyIds: new Set(),
    canViewConsolidated: false,
    accessModes: new Set(),
    profiles: new Set(),
    delegationAuthorities: [],
  }
  companyIds.forEach((companyId) => current.companyIds.add(companyId))
  current.canViewConsolidated ||= canViewConsolidated
  current.accessModes.add(mode)
  current.profiles.add(profile)
  if (delegationAuthority && !current.delegationAuthorities.some((item) => item.sourceId === delegationAuthority.sourceId)) {
    current.delegationAuthorities.push(delegationAuthority)
  }
  target.set(group.id, current)
}

function finalizeCompanyAccess(value: MutableCompanyAccess): CorporateCompanyAccessSummary {
  return {
    companyId: value.companyId,
    companyName: value.companyName,
    groupId: value.groupId,
    groupName: value.groupName,
    sources: [...value.sources],
    profiles: [...value.profiles],
    permissions: mergePermissions(value.permissionSets),
    delegationAuthorities: value.delegationAuthorities,
  }
}

function finalizeGroupAccess(value: MutableGroupAccess): CorporateGroupAccessSummary {
  return {
    groupId: value.groupId,
    groupName: value.groupName,
    companyIds: [...value.companyIds].sort(),
    canViewConsolidated: value.canViewConsolidated,
    accessModes: [...value.accessModes],
    profiles: [...value.profiles],
    delegationAuthorities: value.delegationAuthorities,
  }
}

function createContexts(
  companies: CorporateCompanyAccessSummary[],
  groups: CorporateGroupAccessSummary[],
): CorporateContextOption[] {
  const companyById = new Map(companies.map((company) => [company.companyId, company]))
  return [
    ...groups.flatMap((group) => {
      const companyIds = group.companyIds.filter((companyId) => (
        companyById.get(companyId)?.permissions.ver_consolidado_grupo
      ))
      if (!group.canViewConsolidated || !companyIds.length) return []
      return [{
        type: 'group' as const,
        id: group.groupId,
        label: `Visao consolidada - ${group.groupName}`,
        groupId: group.groupId,
        companyIds,
        canViewConsolidated: true,
      }]
    }),
    ...companies.filter((company) => company.permissions.ver_empresas).map((company) => ({
      type: 'company' as const,
      id: company.companyId,
      label: company.companyName,
      groupId: company.groupId,
      companyIds: [company.companyId],
      canViewConsolidated: false,
    })),
  ]
}

function selectDefaultContext(
  preference: CorporateAccessPreferenceRow | null,
  contexts: CorporateContextOption[],
  groupGrants: CorporateAccessGroupGrantRow[],
): CorporateAccessSummary['defaultContext'] {
  if (preference?.default_context_type === 'company' && preference.default_company_id &&
      contexts.some((context) => context.type === 'company' && context.id === preference.default_company_id)) {
    return { type: 'company', id: preference.default_company_id }
  }
  if (preference?.default_context_type === 'group' && preference.default_group_id &&
      contexts.some((context) => context.type === 'group' && context.id === preference.default_group_id)) {
    return { type: 'group', id: preference.default_group_id }
  }
  const preferredGroupIds = new Set(groupGrants
    .filter((grant) => grant.can_view_consolidated && ['owner', 'ceo', 'group_admin'].includes(grant.corporate_profile))
    .map((grant) => grant.business_group_id))
  const groupContext = contexts.find((context) => context.type === 'group' && preferredGroupIds.has(context.id))
  const fallback = groupContext || contexts[0]
  return fallback ? { type: fallback.type, id: fallback.id } : null
}

async function loadCompanies(client: PoolClient, tenantId: string): Promise<CorporateAccessCompanyRow[]> {
  const result = await client.query<CorporateAccessCompanyRow>(
    `select company_row.id,
            coalesce(company_row.trade_name, company_row.legal_name) as name,
            company_row.group_id,
            group_row.name as group_name
     from companies company_row
     left join business_groups group_row
       on group_row.tenant_id = company_row.tenant_id
      and group_row.id = company_row.group_id
      and group_row.deleted_at is null
     where company_row.tenant_id = $1
       and company_row.status = 'active'
       and company_row.deleted_at is null
     order by coalesce(company_row.trade_name, company_row.legal_name)`,
    [tenantId],
  )
  return result.rows
}

async function loadGroups(client: PoolClient, tenantId: string): Promise<CorporateAccessGroupRow[]> {
  const result = await client.query<CorporateAccessGroupRow>(
    `select id, name from business_groups
     where tenant_id = $1 and status = 'active' and deleted_at is null
     order by name`,
    [tenantId],
  )
  return result.rows
}

async function loadGroupGrants(client: PoolClient, tenantId: string, membershipId: string): Promise<CorporateAccessGroupGrantRow[]> {
  const result = await client.query<CorporateAccessGroupGrantRow>(
    `select grant_row.id, grant_row.business_group_id, grant_row.corporate_profile,
            grant_row.access_mode, grant_row.can_view_consolidated,
            grant_row.permission_overrides,
            coalesce(array_agg(selected.company_id) filter (where selected.company_id is not null), '{}') as selected_company_ids
     from corporate_group_access_grants grant_row
     left join corporate_group_access_companies selected
       on selected.tenant_id = grant_row.tenant_id
      and selected.group_access_grant_id = grant_row.id
     where grant_row.tenant_id = $1
       and grant_row.membership_id = $2
       and grant_row.status = 'active'
       and grant_row.valid_from <= now()
       and (grant_row.valid_until is null or grant_row.valid_until > now())
     group by grant_row.id`,
    [tenantId, membershipId],
  )
  return result.rows
}

async function loadCompanyGrants(client: PoolClient, tenantId: string, membershipId: string): Promise<CorporateAccessCompanyGrantRow[]> {
  const result = await client.query<CorporateAccessCompanyGrantRow>(
    `select id, company_id, corporate_profile, permission_overrides
     from corporate_company_access_grants
     where tenant_id = $1 and membership_id = $2
       and status = 'active'
       and valid_from <= now()
       and (valid_until is null or valid_until > now())`,
    [tenantId, membershipId],
  )
  return result.rows
}

async function loadPreference(client: PoolClient, tenantId: string, membershipId: string): Promise<CorporateAccessPreferenceRow | null> {
  const result = await client.query<CorporateAccessPreferenceRow>(
    `select default_context_type, default_company_id, default_group_id
     from membership_corporate_preferences
     where tenant_id = $1 and membership_id = $2`,
    [tenantId, membershipId],
  )
  return result.rows[0] || null
}

async function hasCorporateAccessConfiguration(
  client: PoolClient,
  tenantId: string,
  membershipId: string,
): Promise<boolean> {
  const result = await client.query<{ configured: boolean }>(
    `select exists (
       select 1 from corporate_group_access_grants
       where tenant_id = $1 and membership_id = $2 and status <> 'revoked'
       union all
       select 1 from corporate_company_access_grants
       where tenant_id = $1 and membership_id = $2 and status <> 'revoked'
     ) as configured`,
    [tenantId, membershipId],
  )
  return Boolean(result.rows[0]?.configured)
}

async function loadMembershipScope(userId: string, tenantId: string): Promise<MembershipScopeRow | null> {
  return withTenantTransaction(tenantId, async (client) => {
    const result = await client.query<MembershipScopeRow>(
      `select membership.id as membership_id, role_row.role_key, membership.profile_key,
              user_row.platform_admin, membership.company_id, membership.allowed_company_ids,
              membership.allowed_group_ids,
              coalesce((
                select jsonb_object_agg(role_permission.permission_key, role_permission.allowed)
                from role_permissions role_permission where role_permission.role_id = role_row.id
              ), '{}'::jsonb) || membership.custom_permissions as permissions
       from tenant_memberships membership
       join users user_row on user_row.id = membership.user_id
       join roles role_row on role_row.id = membership.role_id
       where membership.tenant_id = $1 and membership.user_id = $2
       limit 1`,
      [tenantId, userId],
    )
    return result.rows[0] || null
  })
}

export function normalizeMembershipPermissions(value: Record<string, unknown> | null, profile: string | null): Permissoes {
  const defaults = profile && Object.prototype.hasOwnProperty.call(PERMISSOES_PADRAO_POR_PERFIL, profile)
    ? PERMISSOES_PADRAO_POR_PERFIL[profile as keyof typeof PERMISSOES_PADRAO_POR_PERFIL]
    : PERMISSOES_PADRAO_POR_PERFIL.operacional
  return Object.fromEntries(Object.keys(defaults).map((permission) => [
    permission,
    typeof value?.[permission] === 'boolean' ? value[permission] : defaults[permission as keyof Permissoes],
  ])) as unknown as Permissoes
}

function legacyProfile(roleKey: string): CorporateProfile {
  if (roleKey === 'tenant_admin') return 'owner'
  if (roleKey === 'financial_manager') return 'group_finance'
  if (roleKey === 'company_admin') return 'company_admin'
  if (roleKey === 'requester') return 'requester'
  if (roleKey === 'readonly') return 'viewer'
  return 'manager'
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function uniqueProfiles(values: readonly CorporateProfile[]): CorporateProfile[] {
  return Array.from(new Set(values))
}
