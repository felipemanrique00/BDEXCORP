import { describe, expect, it } from 'vitest'

import {
  canAssignRequesterMembership,
  isRequesterUser,
  isRequesterLinkableMembershipRole,
  userAccessKind,
} from '@/lib/user-access-kind'

describe('userAccessKind', () => {
  it('keeps scoped internal profiles internal even when hydration exposes a corporate grant profile', () => {
    expect(userAccessKind({
      role: 'master',
      role_key: 'supervisor',
      corporate_profile: 'manager',
    })).toBe('internal')
  })

  it('uses the corporate role key even with the historical operational profile fallback', () => {
    expect(userAccessKind({
      role: 'company_admin',
      role_key: 'company_admin',
      corporate_profile: 'group_admin',
    })).toBe('corporate')
  })

  it('supports legacy users without role_key', () => {
    expect(userAccessKind({ role: 'master' })).toBe('internal')
    expect(userAccessKind({ role: 'colaborador', corporate_profile: 'requester' })).toBe('corporate')
  })

  it('uses an explicit role key before a stale requester corporate profile', () => {
    expect(isRequesterUser({
      role: 'company_admin',
      role_key: 'company_admin',
      corporate_profile: 'requester',
    })).toBe(false)
    expect(isRequesterUser({
      role: 'colaborador',
      role_key: 'requester',
      corporate_profile: 'viewer',
    })).toBe(true)
    expect(isRequesterUser({
      role: 'colaborador',
      corporate_profile: 'requester',
    })).toBe(true)
  })

  it('allows requester links only to explicitly corporate memberships', () => {
    expect(isRequesterLinkableMembershipRole('requester')).toBe(true)
    expect(isRequesterLinkableMembershipRole('company_admin')).toBe(true)
    expect(isRequesterLinkableMembershipRole('readonly')).toBe(true)
    expect(isRequesterLinkableMembershipRole('supervisor')).toBe(false)
    expect(isRequesterLinkableMembershipRole('tenant_admin')).toBe(false)
    expect(isRequesterLinkableMembershipRole(null)).toBe(false)
  })

  it('preserves a legacy internal link but rejects assigning a different internal account', () => {
    expect(canAssignRequesterMembership({
      roleKey: 'supervisor',
      requestedUserId: 'internal-user',
      existingUserId: 'internal-user',
    })).toBe(true)
    expect(canAssignRequesterMembership({
      roleKey: 'supervisor',
      requestedUserId: 'internal-user',
      existingUserId: null,
    })).toBe(false)
    expect(canAssignRequesterMembership({
      roleKey: 'requester',
      requestedUserId: 'requester-user',
      existingUserId: null,
    })).toBe(true)
  })
})
