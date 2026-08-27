import {
  CORPORATE_PROFILE_PERMISSIONS,
  type CorporateProfile,
  type Permissoes,
} from '@/types'

export const CORPORATE_PROFILE_LABELS: Record<CorporateProfile, string> = {
  owner: 'Proprietário do grupo (escopo corporativo)',
  ceo: 'CEO / Diretoria',
  group_admin: 'Administrador do grupo',
  executive_assistant: 'Secretaria executiva',
  group_finance: 'Financeiro do grupo',
  manager: 'Gestor',
  approver: 'Autorizador',
  viewer: 'Visualizador',
  company_admin: 'Administrador de empresa',
  requester: 'Solicitante',
}

export const CORPORATE_PROFILES = Object.keys(CORPORATE_PROFILE_LABELS) as CorporateProfile[]
export const CORPORATE_PERMISSION_KEYS = Object.keys(
  CORPORATE_PROFILE_PERMISSIONS.owner,
).filter((permission) => permission !== 'gerenciar_personificacoes') as Array<keyof Permissoes>
export const PERMISSION_KEYS = Object.keys(CORPORATE_PROFILE_PERMISSIONS.viewer) as Array<keyof Permissoes>

export function permissionsForCorporateProfile(
  profile: CorporateProfile,
  overrides: Record<string, unknown> | null | undefined,
): Permissoes {
  const result = { ...CORPORATE_PROFILE_PERMISSIONS[profile] }
  for (const permission of CORPORATE_PERMISSION_KEYS) {
    if (typeof overrides?.[permission] === 'boolean') result[permission] = overrides[permission]
  }
  return result
}

export function mergePermissions(values: readonly Permissoes[]): Permissoes {
  const merged = Object.fromEntries(PERMISSION_KEYS.map((permission) => [permission, false])) as unknown as Permissoes
  for (const permission of PERMISSION_KEYS) {
    merged[permission] = values.some((value) => value[permission] === true)
  }
  return merged
}

export function permissionOverridesOnly(value: Record<string, unknown> | null | undefined): Partial<Permissoes> {
  if (!value) return {}
  return Object.fromEntries(
    CORPORATE_PERMISSION_KEYS.flatMap((permission) => (
      typeof value[permission] === 'boolean' ? [[permission, value[permission]]] : []
    )),
  ) as Partial<Permissoes>
}

export function corporateProfileToLegacyRole(profile: CorporateProfile): 'company_admin' | 'colaborador' {
  return ['owner', 'group_admin', 'company_admin'].includes(profile) ? 'company_admin' : 'colaborador'
}

export function corporateProfileToMembershipRoleKey(profile: CorporateProfile): 'company_admin' | 'requester' | 'readonly' {
  if (profile === 'requester') return 'requester'
  if (profile === 'viewer' || profile === 'approver') return 'readonly'
  return 'company_admin'
}

export function isCorporateProfile(value: unknown): value is CorporateProfile {
  return typeof value === 'string' && CORPORATE_PROFILES.includes(value as CorporateProfile)
}
