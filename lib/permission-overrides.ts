import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import type { PerfilBBT, Permissoes } from '@/types'

const PERMISSION_KEYS = Object.keys(PERMISSOES_PADRAO_POR_PERFIL.operacional) as Array<keyof Permissoes>

export type InternalPermissionBases = Record<PerfilBBT, Permissoes>

export function normalizeInternalPermissionBases(
  value: Partial<Record<PerfilBBT, Partial<Permissoes>>> | Record<string, unknown> | null | undefined,
): InternalPermissionBases {
  return Object.fromEntries(
    (Object.keys(PERMISSOES_PADRAO_POR_PERFIL) as PerfilBBT[]).map((profile) => {
      const configured = value?.[profile]
      return [
        profile,
        applyPermissionOverrides(
          PERMISSOES_PADRAO_POR_PERFIL[profile],
          configured && typeof configured === 'object'
            ? configured as Partial<Permissoes>
            : undefined,
        ),
      ]
    }),
  ) as InternalPermissionBases
}

export function normalizePermissionOverrides(
  value: Partial<Permissoes> | Record<string, unknown> | null | undefined,
): Partial<Permissoes> {
  if (!value) return {}
  const normalized: Partial<Permissoes> = {}
  for (const permission of PERMISSION_KEYS) {
    const allowed = value[permission]
    if (typeof allowed === 'boolean') normalized[permission] = allowed
  }
  return normalized
}

export function applyPermissionOverrides(
  defaults: Permissoes,
  overrides: Partial<Permissoes> | Record<string, unknown> | null | undefined,
): Permissoes {
  return {
    ...defaults,
    ...normalizePermissionOverrides(overrides),
  }
}

export function permissionOverridesFromEffective(
  defaults: Permissoes,
  permissions: Partial<Permissoes> | Record<string, unknown>,
): Partial<Permissoes> {
  const overrides: Partial<Permissoes> = {}
  for (const permission of PERMISSION_KEYS) {
    const allowed = permissions[permission]
    if (typeof allowed === 'boolean' && allowed !== defaults[permission]) {
      overrides[permission] = allowed
    }
  }
  return overrides
}

export function hasPermissionOverrides(
  value: Partial<Permissoes> | Record<string, unknown> | null | undefined,
): boolean {
  return Object.keys(normalizePermissionOverrides(value)).length > 0
}

export function permissionsForInternalProfile(
  profile: PerfilBBT,
  overrides?: Partial<Permissoes> | Record<string, unknown> | null,
  base: Permissoes = PERMISSOES_PADRAO_POR_PERFIL[profile],
): Permissoes {
  return applyPermissionOverrides(base, overrides)
}

export function sparseOverridesForInternalProfile(
  profile: PerfilBBT,
  overrides: Partial<Permissoes> | Record<string, unknown> | null | undefined,
  base: Permissoes = PERMISSOES_PADRAO_POR_PERFIL[profile],
): Partial<Permissoes> {
  return permissionOverridesFromEffective(
    base,
    applyPermissionOverrides(base, overrides),
  )
}

export function internalProfileChange(
  profile: PerfilBBT,
  base: Permissoes = PERMISSOES_PADRAO_POR_PERFIL[profile],
): {
  profile: PerfilBBT
  customPermissions: false
  permissions: Permissoes
  permissionOverrides: Partial<Permissoes>
} {
  return {
    profile,
    customPermissions: false,
    permissions: { ...base },
    permissionOverrides: {},
  }
}

export function internalPermissionMutationPayload(
  customPermissions: boolean,
  permissionOverrides: Partial<Permissoes>,
): Partial<Permissoes> {
  return customPermissions
    ? normalizePermissionOverrides(permissionOverrides)
    : {}
}
