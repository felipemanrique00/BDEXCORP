import type {
  CorporateAccessSummary,
  CorporateDelegationAuthority,
  Permissoes,
  User,
} from '@/types'

export type SessionUserRefreshDecision = 'keep' | 'update' | 'reload' | 'redirect'

interface SessionRefreshState {
  reachable: boolean
  user: User | null
}

export function createSingleFlightRunner<T>(
  task: () => Promise<T>,
): () => Promise<T> {
  let inFlight: Promise<T> | null = null

  return () => {
    if (inFlight) return inFlight
    const request = Promise.resolve().then(task)
    const trackedRequest = request.finally(() => {
      if (inFlight === trackedRequest) inFlight = null
    })
    inFlight = trackedRequest
    return trackedRequest
  }
}

export function decideSessionUserRefresh(
  currentUser: User,
  session: SessionRefreshState,
): SessionUserRefreshDecision {
  if (!session.reachable) return 'keep'
  if (!session.user) return 'redirect'
  return sessionAuthorizationFingerprint(currentUser) === sessionAuthorizationFingerprint(session.user)
    ? 'update'
    : 'reload'
}

export function sessionAuthorizationFingerprint(user: User): string {
  return JSON.stringify({
    id: user.id,
    tenantId: user.tenant_id || null,
    membershipId: user.membership_id || null,
    role: user.role,
    roleKey: user.role_key || null,
    platformAdmin: user.platform_admin === true,
    mustChangePassword: user.must_change_password === true,
    active: user.ativo !== false,
    status: user.status || null,
    profile: user.perfil_bbt || null,
    corporateProfile: user.corporate_profile || null,
    companyIds: sortedStrings(user.empresa_ids),
    groupIds: sortedStrings(user.grupo_ids),
    permissions: sortedPermissions(user.permissoes),
    corporateAccess: authorizationCorporateAccess(user.corporate_access),
  })
}

function authorizationCorporateAccess(
  access: CorporateAccessSummary | null | undefined,
): Record<string, unknown> | null {
  if (!access) return null
  return {
    tenantWide: access.tenantWide,
    companyIds: sortedStrings(access.companyIds),
    groupIds: sortedStrings(access.groupIds),
    companies: access.companies
      .map((company) => ({
        companyId: company.companyId,
        groupId: company.groupId,
        sources: sortedStrings(company.sources),
        profiles: sortedStrings(company.profiles),
        permissions: sortedPermissions(company.permissions),
        delegationAuthorities: sortedAuthorities(company.delegationAuthorities),
      }))
      .sort(compareSerialized),
    groups: access.groups
      .map((group) => ({
        groupId: group.groupId,
        companyIds: sortedStrings(group.companyIds),
        canViewConsolidated: group.canViewConsolidated,
        accessModes: sortedStrings(group.accessModes),
        profiles: sortedStrings(group.profiles),
        delegationAuthorities: sortedAuthorities(group.delegationAuthorities),
      }))
      .sort(compareSerialized),
  }
}

function sortedAuthorities(
  authorities: CorporateDelegationAuthority[] | undefined,
): Array<Record<string, unknown>> {
  return (authorities || [])
    .map((authority) => ({
      sourceId: authority.sourceId,
      source: authority.source,
      profile: authority.profile,
      companyIds: sortedStrings(authority.companyIds),
      accessMode: authority.accessMode,
      canViewConsolidated: authority.canViewConsolidated,
      permissions: sortedPermissions(authority.permissions),
    }))
    .sort(compareSerialized)
}

function sortedPermissions(
  permissions: Partial<Permissoes> | null | undefined,
): Array<[string, boolean]> {
  if (!permissions) return []
  return Object.entries(permissions)
    .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
    .sort(([left], [right]) => left.localeCompare(right))
}

function sortedStrings(values: readonly string[] | null | undefined): string[] {
  return [...new Set(values || [])].sort((left, right) => left.localeCompare(right))
}

function compareSerialized(left: unknown, right: unknown): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right))
}
