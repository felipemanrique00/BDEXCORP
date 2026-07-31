import type { User } from '@/types'

const INTERNAL_ROLE_KEYS = new Set([
  'tenant_admin',
  'financial_manager',
  'supervisor',
  'agent',
  'operator',
])

const CORPORATE_ROLE_KEYS = new Set([
  'company_admin',
  'requester',
  'readonly',
])

export type UserAccessKind = 'internal' | 'corporate'

export function userAccessKind(
  user: Pick<User, 'role' | 'role_key' | 'corporate_profile'>,
): UserAccessKind {
  const roleKey = String(user.role_key || '').trim()
  if (INTERNAL_ROLE_KEYS.has(roleKey)) return 'internal'
  if (CORPORATE_ROLE_KEYS.has(roleKey)) return 'corporate'
  if (user.role === 'master') return 'internal'
  if (user.role === 'company_admin' || user.role === 'colaborador') return 'corporate'
  return user.corporate_profile ? 'corporate' : 'internal'
}

export function isRequesterLinkableMembershipRole(roleKey: string | null | undefined): boolean {
  return CORPORATE_ROLE_KEYS.has(String(roleKey || '').trim())
}

export function canAssignRequesterMembership(input: {
  roleKey: string | null | undefined
  requestedUserId: string
  existingUserId: string | null
}): boolean {
  return input.requestedUserId === input.existingUserId
    || isRequesterLinkableMembershipRole(input.roleKey)
}
