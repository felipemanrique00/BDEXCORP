import { describe, expect, it } from 'vitest'

import {
  canCreateCompanyForGroup,
  canCreateCompanyWithoutGroup,
  companyGroupIdsAvailableForCreation,
} from '@/lib/company-creation-access'
import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import type { CorporateAccessSummary, GrupoEmpresarial, User } from '@/types'

const groups = [
  { id: 'group-a', nome: 'Grupo A', ativo: true, empresa_ids: ['company-a'] },
  { id: 'group-inactive', nome: 'Grupo inativo', ativo: false, empresa_ids: [] },
] as GrupoEmpresarial[]

describe('company creation access', () => {
  it('permite ao perfil interno tenant-wide criar sem grupo ou em grupo persistido', () => {
    const user = internalSupervisor()

    expect(canCreateCompanyWithoutGroup(user)).toBe(true)
    expect(canCreateCompanyForGroup(user, 'group-a', groups)).toBe(true)
    expect(canCreateCompanyForGroup(user, 'group-inactive', groups)).toBe(false)
    expect(canCreateCompanyForGroup(user, 'group-unknown', groups)).toBe(false)
  })

  it('bloqueia criacao por perfil interno com escopo parcial', () => {
    const user = internalSupervisor()
    user.corporate_access = {
      ...user.corporate_access!,
      tenantWide: false,
    }

    expect(canCreateCompanyWithoutGroup(user)).toBe(false)
    expect(companyGroupIdsAvailableForCreation(user, groups)).toEqual(new Set())
  })

  it('limita group_admin a grupo all_companies comprovado', () => {
    const user = corporateGroupAdmin('group_all', 'all_companies')

    expect(canCreateCompanyWithoutGroup(user)).toBe(false)
    expect(companyGroupIdsAvailableForCreation(user, groups)).toEqual(new Set(['group-a']))
    expect(canCreateCompanyForGroup(user, 'group-a', groups)).toBe(true)

    const selected = corporateGroupAdmin('group_selected', 'selected_companies')
    expect(companyGroupIdsAvailableForCreation(selected, groups)).toEqual(new Set())
  })
})

function internalSupervisor(): User {
  const permissions = { ...PERMISSOES_PADRAO_POR_PERFIL.supervisor }
  const access: CorporateAccessSummary = {
    tenantWide: true,
    companyIds: ['company-a'],
    groupIds: ['group-a'],
    companies: [{
      companyId: 'company-a',
      companyName: 'Empresa A',
      groupId: 'group-a',
      groupName: 'Grupo A',
      sources: ['legacy_unscoped'],
      profiles: ['manager'],
      permissions,
    }],
    groups: [{
      groupId: 'group-a',
      groupName: 'Grupo A',
      companyIds: ['company-a'],
      canViewConsolidated: true,
      accessModes: ['all_companies'],
      profiles: ['manager'],
    }],
    contexts: [],
    defaultContext: null,
    refreshedAt: new Date(0).toISOString(),
  }
  return {
    id: 'supervisor-a',
    email: 'supervisor@example.invalid',
    name: 'Supervisor',
    role: 'master',
    role_key: 'supervisor',
    company_id: null,
    empresa_ids: ['company-a'],
    grupo_ids: ['group-a'],
    perfil_bbt: 'supervisor',
    permissoes: permissions,
    corporate_access: access,
    ativo: true,
  }
}

function corporateGroupAdmin(
  source: 'group_all' | 'group_selected',
  mode: 'all_companies' | 'selected_companies',
): User {
  const permissions = permissionsForCorporateProfile('group_admin', {})
  const access: CorporateAccessSummary = {
    tenantWide: false,
    companyIds: ['company-a'],
    groupIds: ['group-a'],
    companies: [{
      companyId: 'company-a',
      companyName: 'Empresa A',
      groupId: 'group-a',
      groupName: 'Grupo A',
      sources: [source],
      profiles: ['group_admin'],
      permissions,
    }],
    groups: [{
      groupId: 'group-a',
      groupName: 'Grupo A',
      companyIds: ['company-a'],
      canViewConsolidated: true,
      accessModes: [mode],
      profiles: ['group_admin'],
    }],
    contexts: [],
    defaultContext: null,
    refreshedAt: new Date(0).toISOString(),
  }
  return {
    id: 'group-admin-a',
    email: 'group-admin@example.invalid',
    name: 'Group Admin',
    role: 'company_admin',
    role_key: 'company_admin',
    company_id: 'company-a',
    empresa_ids: ['company-a'],
    grupo_ids: ['group-a'],
    corporate_profile: 'group_admin',
    permissoes: permissions,
    corporate_access: access,
    ativo: true,
  }
}
