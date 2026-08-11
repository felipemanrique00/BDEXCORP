import { describe, expect, it } from 'vitest'

import { requiresAdministrativeMfa } from '@/lib/security/mfa-policy'
import type { RequestPrincipal } from '@/lib/server/request-context'
import { PERMISSOES_PADRAO_POR_PERFIL, type Permissoes } from '@/types'

const NO_PERMISSIONS = Object.fromEntries(
  Object.keys(PERMISSOES_PADRAO_POR_PERFIL.operacional).map((key) => [key, false]),
) as unknown as Permissoes

describe('administrative MFA policy', () => {
  it('requires MFA for a consultant with integration-management access', () => {
    expect(requiresAdministrativeMfa(principal({
      roleKey: 'agent',
      permissions: PERMISSOES_PADRAO_POR_PERFIL.agente,
    }))).toBe(true)
  })

  it('does not classify a strictly operational consultant as administrative', () => {
    expect(requiresAdministrativeMfa(principal({
      roleKey: 'agent',
      permissions: {
        ...PERMISSOES_PADRAO_POR_PERFIL.agente,
        gerenciar_integracoes: false,
      },
    }))).toBe(false)
  })

  it('always requires MFA for tenant and platform administrators', () => {
    expect(requiresAdministrativeMfa(principal({
      roleKey: 'tenant_admin',
      permissions: NO_PERMISSIONS,
    }))).toBe(true)
    expect(requiresAdministrativeMfa(principal({
      roleKey: 'agent',
      permissions: NO_PERMISSIONS,
      platformAdmin: true,
    }))).toBe(true)
  })
})

function principal(input: {
  roleKey: string
  permissions: RequestPrincipal['user']['permissoes']
  platformAdmin?: boolean
}): RequestPrincipal {
  return {
    sessionId: 'session-test',
    tenantId: 'tenant-test',
    tenantSlug: 'tenant-test',
    tenantStatus: 'active',
    membershipId: 'membership-test',
    roleKey: input.roleKey,
    platformAdmin: input.platformAdmin === true,
    planKey: 'business',
    entitlements: {},
    limits: { users: null, storageBytes: null, monthlyOperations: null },
    user: {
      id: 'user-test',
      email: 'consultor@test.invalid',
      name: 'Consultor Teste',
      role: 'master',
      role_key: input.roleKey,
      platform_admin: input.platformAdmin === true,
      company_id: null,
      perfil_bbt: 'agente',
      permissoes: input.permissions,
      ativo: true,
    },
  }
}
