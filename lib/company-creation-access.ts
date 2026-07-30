import { hasScopedAccess } from '@/lib/grupos'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import type { GrupoEmpresarial, User } from '@/types'

const INTERNAL_ROLE_KEYS = new Set([
  'tenant_admin',
  'financial_manager',
  'supervisor',
  'agent',
  'operator',
])

export function canCreateCompanyWithoutGroup(user: User | null): boolean {
  return isTenantWideAgencyUser(user) && hasCreateCompanyPermission(user)
}

export function companyGroupIdsAvailableForCreation(
  user: User | null,
  groups: GrupoEmpresarial[],
): Set<string> {
  const activeGroupIds = new Set(
    groups
      .filter((group) => group.ativo !== false)
      .map((group) => group.id),
  )
  if (canCreateCompanyWithoutGroup(user)) return activeGroupIds
  if (!user?.corporate_access) return new Set()

  return new Set(user.corporate_access.groups
    .filter((group) => activeGroupIds.has(group.groupId))
    .filter((group) => group.accessModes.includes('all_companies'))
    .filter((group) => group.companyIds.some((companyId) => (
      user.corporate_access?.companies.some((company) => (
        company.companyId === companyId
        && company.groupId === group.groupId
        && company.sources.includes('group_all')
        && company.permissions.cadastrar_empresas
        && company.permissions.gerenciar_empresas_grupo
      ))
    )))
    .map((group) => group.groupId))
}

export function canCreateCompanyForGroup(
  user: User | null,
  groupId: string | null | undefined,
  groups: GrupoEmpresarial[],
): boolean {
  const normalizedGroupId = String(groupId || '').trim()
  if (!normalizedGroupId) return canCreateCompanyWithoutGroup(user)
  return companyGroupIdsAvailableForCreation(user, groups).has(normalizedGroupId)
}

export function isTenantWideAgencyUser(user: User | null): boolean {
  if (!user) return false
  const internal = user.role === 'master' || INTERNAL_ROLE_KEYS.has(user.role_key || '')
  return internal && !hasScopedAccess(user)
}

function hasCreateCompanyPermission(user: User | null): boolean {
  if (!user || user.ativo === false) return false
  if (user.platform_admin) return true
  if (user.permissoes) return user.permissoes.cadastrar_empresas
  return user.perfil_bbt
    ? PERMISSOES_PADRAO_POR_PERFIL[user.perfil_bbt].cadastrar_empresas
    : false
}
