import { CORPORATE_PROFILE_PERMISSIONS } from '@/types'
import type { CorporateProfile, Permissoes } from '@/types'
import {
  applyPermissionOverrides,
  permissionOverridesFromEffective,
} from '@/lib/permission-overrides'

const CORPORATE_PERMISSION_KEYS = Object.keys(
  CORPORATE_PROFILE_PERMISSIONS.owner,
) as Array<keyof Permissoes>

export interface GroupAccessDraft {
  groupId: string
  profile: CorporateProfile
  permissionOverrides: Partial<Permissoes>
  accessMode: 'all_companies' | 'selected_companies'
  companyIds: string[]
  canViewConsolidated: boolean
  status: 'active' | 'suspended'
  validFrom: string
  validUntil: string
}

export interface CompanyAccessDraft {
  companyId: string
  profile: CorporateProfile
  permissionOverrides: Partial<Permissoes>
  status: 'active' | 'suspended'
  validFrom: string
  validUntil: string
}

export interface CorporateAccessDraft {
  profile: CorporateProfile
  customPermissions: boolean
  permissions: Permissoes
  groupGrants: GroupAccessDraft[]
  companyGrants: CompanyAccessDraft[]
  defaultContextKey: string
}

export function createCorporateAccessDraft(profile: CorporateProfile = 'viewer'): CorporateAccessDraft {
  return {
    profile,
    customPermissions: false,
    permissions: { ...CORPORATE_PROFILE_PERMISSIONS[profile] },
    groupGrants: [],
    companyGrants: [],
    defaultContextKey: '',
  }
}

export function isCorporateAccessDraftReady(
  existingCorporateUserId: string | null,
  loadedCorporateUserId: string | null,
  loading: boolean,
): boolean {
  return !existingCorporateUserId
    || (!loading && loadedCorporateUserId === existingCorporateUserId)
}

export function corporateDraftPermissionState(
  profile: CorporateProfile,
  groupGrants: readonly Pick<GroupAccessDraft, 'profile' | 'permissionOverrides'>[],
  companyGrants: readonly Pick<CompanyAccessDraft, 'profile' | 'permissionOverrides'>[],
): Pick<CorporateAccessDraft, 'customPermissions' | 'permissions'> {
  const grants = [...groupGrants, ...companyGrants]
  if (grants.length === 0) {
    return {
      customPermissions: false,
      permissions: { ...CORPORATE_PROFILE_PERMISSIONS[profile] },
    }
  }

  const effectivePermissions = grants.map((grant) => (
    applyPermissionOverrides(
      CORPORATE_PROFILE_PERMISSIONS[grant.profile],
      grant.permissionOverrides,
    )
  ))
  return {
    customPermissions: grants.some((grant) => (
      Object.keys(sparseCorporateOverrides(grant.profile, grant.permissionOverrides)).length > 0
    )),
    permissions: Object.fromEntries(CORPORATE_PERMISSION_KEYS.map((permission) => [
      permission,
      effectivePermissions.every((value) => value[permission]),
    ])) as unknown as Permissoes,
  }
}

export function setCorporateDraftCustomization(
  value: CorporateAccessDraft,
  enabled: boolean,
): CorporateAccessDraft {
  if (enabled) {
    const state = corporateDraftPermissionState(
      value.profile,
      value.groupGrants,
      value.companyGrants,
    )
    return {
      ...value,
      customPermissions: true,
      permissions: value.groupGrants.length || value.companyGrants.length
        ? state.permissions
        : value.permissions,
    }
  }

  const groupGrants = value.groupGrants.map((grant) => ({
    ...grant,
    permissionOverrides: {},
    canViewConsolidated: CORPORATE_PROFILE_PERMISSIONS[grant.profile].ver_consolidado_grupo
      && grant.canViewConsolidated,
  }))
  const companyGrants = value.companyGrants.map((grant) => ({
    ...grant,
    permissionOverrides: {},
  }))
  return {
    ...value,
    ...corporateDraftPermissionState(value.profile, groupGrants, companyGrants),
    customPermissions: false,
    groupGrants,
    companyGrants,
  }
}

export function setCorporateDraftPermission(
  value: CorporateAccessDraft,
  permission: keyof Permissoes,
  allowed: boolean,
): CorporateAccessDraft {
  const groupGrants = value.groupGrants.map((grant) => {
    const defaults = CORPORATE_PROFILE_PERMISSIONS[grant.profile]
    const permissions = {
      ...applyPermissionOverrides(defaults, grant.permissionOverrides),
      [permission]: allowed,
    }
    return {
      ...grant,
      permissionOverrides: permissionOverridesFromEffective(defaults, permissions),
      canViewConsolidated: permission === 'ver_consolidado_grupo' && !allowed
        ? false
        : grant.canViewConsolidated,
    }
  })
  const companyGrants = value.companyGrants.map((grant) => {
    const defaults = CORPORATE_PROFILE_PERMISSIONS[grant.profile]
    const permissions = {
      ...applyPermissionOverrides(defaults, grant.permissionOverrides),
      [permission]: allowed,
    }
    return {
      ...grant,
      permissionOverrides: permissionOverridesFromEffective(defaults, permissions),
    }
  })
  const state = corporateDraftPermissionState(value.profile, groupGrants, companyGrants)
  return {
    ...value,
    customPermissions: true,
    permissions: groupGrants.length || companyGrants.length
      ? state.permissions
      : { ...value.permissions, [permission]: allowed },
    groupGrants,
    companyGrants,
  }
}

export function corporateDraftToPayload(value: CorporateAccessDraft) {
  return {
    groupGrants: value.groupGrants.map((grant) => ({
      groupId: grant.groupId,
      profile: grant.profile,
      accessMode: grant.accessMode,
      companyIds: grant.accessMode === 'selected_companies' ? grant.companyIds : [],
      canViewConsolidated: grant.canViewConsolidated,
      permissionOverrides: sparseCorporateOverrides(grant.profile, grant.permissionOverrides),
      status: grant.status,
      validFrom: toStartOfDayIso(grant.validFrom),
      validUntil: toEndOfDayIso(grant.validUntil),
    })),
    companyGrants: value.companyGrants.map((grant) => ({
      companyId: grant.companyId,
      profile: grant.profile,
      permissionOverrides: sparseCorporateOverrides(grant.profile, grant.permissionOverrides),
      status: grant.status,
      validFrom: toStartOfDayIso(grant.validFrom),
      validUntil: toEndOfDayIso(grant.validUntil),
    })),
    defaultContext: parseContextKey(value.defaultContextKey),
  }
}

function sparseCorporateOverrides(
  profile: CorporateProfile,
  overrides: Partial<Permissoes>,
): Partial<Permissoes> {
  const defaults = CORPORATE_PROFILE_PERMISSIONS[profile]
  return permissionOverridesFromEffective(
    defaults,
    applyPermissionOverrides(defaults, overrides),
  )
}

function parseContextKey(value: string): { type: 'company' | 'group'; id: string } | null {
  const [type, ...idParts] = value.split(':')
  const id = idParts.join(':')
  return (type === 'company' || type === 'group') && id ? { type, id } : null
}

function toEndOfDayIso(value: string): string | null {
  return value ? new Date(`${value}T23:59:59.999`).toISOString() : null
}

function toStartOfDayIso(value: string): string | null {
  return value ? new Date(`${value}T00:00:00.000`).toISOString() : null
}
