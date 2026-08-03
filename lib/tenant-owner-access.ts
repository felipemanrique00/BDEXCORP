import type { Permissoes } from '@/types'

export const TENANT_OWNER_ROLE_KEY = 'tenant_admin'

export interface TenantOwnerDelegationActor {
  platformAdmin: boolean
  roleKey: string | null | undefined
  permissions: Pick<Permissoes, 'gerenciar_usuarios' | 'gerenciar_vinculos_acesso'> | null | undefined
}

/**
 * Tenant owners are deliberately different from platform administrators.
 * A platform administrator may manage every tenant, while any number of
 * tenant owners may administer only the tenant where their membership lives.
 */
export function canDelegateTenantOwner(actor: TenantOwnerDelegationActor): boolean {
  if (actor.platformAdmin) return true
  return String(actor.roleKey || '').trim() === TENANT_OWNER_ROLE_KEY
    && actor.permissions?.gerenciar_usuarios === true
    && actor.permissions?.gerenciar_vinculos_acesso === true
}

export function changesTenantOwnerMembership(
  currentRoleKey: string | null | undefined,
  nextRoleKey: string | null | undefined,
): boolean {
  return [currentRoleKey, nextRoleKey]
    .some((roleKey) => String(roleKey || '').trim() === TENANT_OWNER_ROLE_KEY)
}
