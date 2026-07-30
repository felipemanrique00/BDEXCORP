import { describe, expect, it } from 'vitest'

import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import { isRestrictedStorageUser, scopeStorageEntriesForRead, scopeStorageEntriesForWrite } from '@/lib/security/storage-scope'
import type { CorporateAccessSummary, Empresa, User } from '@/types'

const empresas: Empresa[] = [
  { id: 'company-a', nome: 'Empresa A', cnpj: '1', ativa: true } as Empresa,
  { id: 'company-b', nome: 'Empresa B', cnpj: '2', ativa: true } as Empresa,
]

function corporateUser(): User {
  const demandPermissions = permissionsForCorporateProfile('manager', {
    ver_financeiro: false,
    editar_financeiro: false,
  })
  const financePermissions = permissionsForCorporateProfile('group_finance', {
    ver_demandas: false,
    criar_demandas: false,
  })
  const access: CorporateAccessSummary = {
    tenantWide: false,
    companyIds: ['company-a', 'company-b'],
    groupIds: [],
    companies: [
      { companyId: 'company-a', companyName: 'Empresa A', groupId: null, groupName: null, sources: ['direct'], profiles: ['manager'], permissions: demandPermissions },
      { companyId: 'company-b', companyName: 'Empresa B', groupId: null, groupName: null, sources: ['direct'], profiles: ['group_finance'], permissions: financePermissions },
    ],
    groups: [],
    contexts: [],
    defaultContext: { type: 'company', id: 'company-a' },
    refreshedAt: new Date().toISOString(),
  }
  return {
    id: 'user-a',
    email: 'user@example.com',
    name: 'Usuario',
    role: 'company_admin',
    company_id: 'company-a',
    empresa_ids: access.companyIds,
    corporate_profile: 'manager',
    corporate_access: access,
    permissoes: demandPermissions,
  }
}

describe('corporate storage scope', () => {
  it('nao transforma o papel visual master em administrador do storage', () => {
    const user = corporateUser()
    user.role = 'master'
    user.role_key = 'agent'

    expect(isRestrictedStorageUser(user)).toBe(true)
    expect(isRestrictedStorageUser({ ...user, role_key: 'tenant_admin' })).toBe(false)
  })

  it('aplica permissoes diferentes por empresa em leitura e escrita', () => {
    const entries = {
      'bbt-data-v4': { state: { empresas, gruposEmpresariais: [], funcionarios: [], hoteis: [], politicas: [] } },
      'bbt-atendimentos': [
        { id: 'demand-a', empresa_id: 'company-a', valor_venda: 100 },
        { id: 'demand-b', empresa_id: 'company-b', valor_venda: 200 },
      ],
      'bbt-financeiro': [
        { id: 'finance-a', empresa_id: 'company-a', tipo: 'receber', valor: 100 },
        { id: 'finance-b', empresa_id: 'company-b', tipo: 'receber', valor: 200 },
      ],
    }
    const user = corporateUser()

    const visible = scopeStorageEntriesForRead(entries, user)
    expect((visible['bbt-atendimentos'] as Array<{ id: string }>).map((item) => item.id)).toEqual(['demand-a'])
    expect((visible['bbt-financeiro'] as Array<{ id: string }>).map((item) => item.id)).toEqual(['finance-b'])

    const writable = scopeStorageEntriesForWrite({
      'bbt-atendimentos': [
        { id: 'new-demand-a', empresa_id: 'company-a' },
        { id: 'new-demand-b', empresa_id: 'company-b' },
      ],
      'bbt-financeiro': [
        { id: 'new-finance-a', empresa_id: 'company-a', tipo: 'receber' },
        { id: 'new-finance-b', empresa_id: 'company-b', tipo: 'receber' },
      ],
    }, entries, user)

    expect((writable['bbt-atendimentos'] as Array<{ id: string }>).map((item) => item.id)).toEqual(['new-demand-a'])
    expect((writable['bbt-financeiro'] as Array<{ id: string }>).map((item) => item.id)).toEqual(['new-finance-b'])
  })

  it('preserva empresas fora do escopo ao editar um grupo parcialmente', () => {
    const groupAdminPermissions = permissionsForCorporateProfile('group_admin', {})
    const viewerPermissions = permissionsForCorporateProfile('viewer', {})
    const user = corporateUser()
    user.corporate_access = {
      ...user.corporate_access!,
      companyIds: ['company-a', 'company-b'],
      groupIds: ['group-a'],
      companies: [
        { companyId: 'company-a', companyName: 'Empresa A', groupId: 'group-a', groupName: 'Grupo A', sources: ['group_selected'], profiles: ['group_admin'], permissions: groupAdminPermissions },
        { companyId: 'company-b', companyName: 'Empresa B', groupId: 'group-a', groupName: 'Grupo A', sources: ['group_selected'], profiles: ['viewer'], permissions: viewerPermissions },
      ],
      groups: [{ groupId: 'group-a', groupName: 'Grupo A', companyIds: ['company-a', 'company-b'], canViewConsolidated: true, accessModes: ['selected_companies'], profiles: ['group_admin', 'viewer'] }],
    }
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas: empresas.map((empresa) => ({ ...empresa, grupo_id: 'group-a' })),
          gruposEmpresariais: [{ id: 'group-a', nome: 'Grupo A', ativo: true, empresa_ids: ['company-a', 'company-b'] }],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }

    const writable = scopeStorageEntriesForWrite({
      'bbt-data-v4': {
        state: {
          empresas: [{ ...empresas[0], grupo_id: null }],
          gruposEmpresariais: [{ id: 'group-a', nome: 'Grupo A', ativo: true, empresa_ids: [] }],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }, reference, user) as any

    expect(writable['bbt-data-v4'].state.gruposEmpresariais[0].empresa_ids).toEqual(['company-b'])
  })
})
