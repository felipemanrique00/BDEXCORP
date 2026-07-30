import { CORPORATE_PROFILE_PERMISSIONS } from '@/types'
import type { CorporateProfile, Permissoes } from '@/types'

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

export function corporateDraftToPayload(value: CorporateAccessDraft) {
  return {
    groupGrants: value.groupGrants.map((grant) => ({
      groupId: grant.groupId,
      profile: grant.profile,
      accessMode: grant.accessMode,
      companyIds: grant.accessMode === 'selected_companies' ? grant.companyIds : [],
      canViewConsolidated: grant.canViewConsolidated,
      permissionOverrides: grant.permissionOverrides,
      status: grant.status,
      validFrom: toStartOfDayIso(grant.validFrom),
      validUntil: toEndOfDayIso(grant.validUntil),
    })),
    companyGrants: value.companyGrants.map((grant) => ({
      companyId: grant.companyId,
      profile: grant.profile,
      permissionOverrides: grant.permissionOverrides,
      status: grant.status,
      validFrom: toStartOfDayIso(grant.validFrom),
      validUntil: toEndOfDayIso(grant.validUntil),
    })),
    defaultContext: parseContextKey(value.defaultContextKey),
  }
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
