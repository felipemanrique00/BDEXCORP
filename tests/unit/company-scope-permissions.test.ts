import { describe, expect, it } from 'vitest'

import { canManageUserAccess } from '@/lib/auth'
import { hasCompanyScopeAccess } from '@/lib/corporate-company-scope'
import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import type { CorporateAccessSummary, PerfilBBT, Permissoes, User } from '@/types'

function internalUser(profile: PerfilBBT, overrides: Partial<Permissoes> = {}): User {
  return {
    id: `internal-${profile}`,
    email: `${profile}@test.invalid`,
    name: profile,
    role: 'master',
    company_id: null,
    perfil_bbt: profile,
    ativo: true,
    permissoes: {
      ...PERMISSOES_PADRAO_POR_PERFIL[profile],
      ...overrides,
    },
  }
}

describe('company scope permissions', () => {
  it('aplica a matriz efetiva tambem para usuario interno sem escopo corporativo', () => {
    expect(hasCompanyScopeAccess(
      internalUser('supervisor'),
      null,
      null,
      'company-a',
      'gerenciar_solicitantes',
    )).toBe(true)
    expect(hasCompanyScopeAccess(
      internalUser('operacional'),
      null,
      null,
      'company-a',
      'gerenciar_solicitantes',
    )).toBe(false)
    expect(hasCompanyScopeAccess(
      internalUser('agente'),
      null,
      null,
      'company-a',
      'gerenciar_funcionarios',
    )).toBe(true)
  })

  it('respeita overrides internos concedidos e revogados', () => {
    expect(hasCompanyScopeAccess(
      internalUser('operacional', { gerenciar_solicitantes: true }),
      null,
      null,
      'company-a',
      'gerenciar_solicitantes',
    )).toBe(true)
    expect(hasCompanyScopeAccess(
      internalUser('supervisor', { gerenciar_solicitantes: false }),
      null,
      null,
      'company-a',
      'gerenciar_solicitantes',
    )).toBe(false)
  })

  it('mantem a permissao corporativa limitada a empresa autorizada', () => {
    const permissions = permissionsForCorporateProfile('manager', {
      gerenciar_solicitantes: true,
    })
    const access: CorporateAccessSummary = {
      tenantWide: false,
      companyIds: ['company-a'],
      groupIds: [],
      companies: [{
        companyId: 'company-a',
        companyName: 'Empresa A',
        groupId: null,
        groupName: null,
        sources: ['direct'],
        profiles: ['manager'],
        permissions,
      }],
      groups: [],
      contexts: [],
      defaultContext: null,
      refreshedAt: new Date(0).toISOString(),
    }

    expect(hasCompanyScopeAccess(
      { ...internalUser('operacional'), corporate_access: access },
      access,
      new Set(['company-a']),
      'company-a',
      'gerenciar_solicitantes',
    )).toBe(true)
    expect(hasCompanyScopeAccess(
      { ...internalUser('operacional'), corporate_access: access },
      access,
      new Set(['company-a']),
      'company-b',
      'gerenciar_solicitantes',
    )).toBe(false)
  })

  it('habilita administracao somente com o par completo de permissoes de acesso', () => {
    const leader = {
      ...internalUser('lider'),
      role_key: 'tenant_admin',
    }
    expect(canManageUserAccess(leader)).toBe(true)
    expect(canManageUserAccess(internalUser('supervisor', {
      gerenciar_usuarios: true,
      gerenciar_vinculos_acesso: true,
    }))).toBe(true)
    expect(canManageUserAccess(internalUser('supervisor', {
      gerenciar_usuarios: true,
      gerenciar_vinculos_acesso: false,
    }))).toBe(false)

    const delegatedPermissions = permissionsForCorporateProfile('group_admin', {})
    const delegatedAccess: CorporateAccessSummary = {
      tenantWide: false,
      companyIds: ['company-a'],
      groupIds: [],
      companies: [{
        companyId: 'company-a',
        companyName: 'Empresa A',
        groupId: null,
        groupName: null,
        sources: ['direct'],
        profiles: ['group_admin'],
        permissions: delegatedPermissions,
      }],
      groups: [],
      contexts: [],
      defaultContext: null,
      refreshedAt: new Date(0).toISOString(),
    }
    expect(canManageUserAccess({
      ...internalUser('operacional'),
      role: 'company_admin',
      corporate_access: delegatedAccess,
    })).toBe(true)
  })
})
