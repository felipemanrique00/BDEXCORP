import { describe, expect, it } from 'vitest'

import { permissionsForCorporateProfile } from '@/lib/corporate-access'
import {
  hasAcceptedStorageMutation,
  isRestrictedStorageUser,
  scopeStorageEntriesForRead,
  scopeStorageEntriesForWrite,
} from '@/lib/security/storage-scope'
import { createStorageSyncValue, mergeStorageValues } from '@/lib/storage-merge'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
import type { CorporateAccessSummary, Empresa, PerfilBBT, Permissoes, User } from '@/types'

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

function internalUser(profile: PerfilBBT, overrides: Partial<Permissoes> = {}): User {
  const roleKeys: Record<PerfilBBT, string> = {
    lider: 'tenant_admin',
    supervisor: 'supervisor',
    agente: 'agent',
    gestor_financeiro: 'financial_manager',
    operacional: 'operator',
  }
  return {
    id: `internal-${profile}`,
    email: `${profile}@test.invalid`,
    name: profile,
    role: 'master',
    role_key: roleKeys[profile],
    company_id: null,
    perfil_bbt: profile,
    permissoes: {
      ...PERMISSOES_PADRAO_POR_PERFIL[profile],
      ...overrides,
    },
    ativo: true,
  }
}

describe('corporate storage scope', () => {
  it('distingue uma mutacao aceita de um lote totalmente filtrado', () => {
    expect(hasAcceptedStorageMutation('bbt-data-v4', {
      state: {
        empresas: [],
        gruposEmpresariais: [],
        funcionarios: [],
        hoteis: [],
        politicas: [],
      },
    })).toBe(false)
    expect(hasAcceptedStorageMutation('bbt-data-v4', {
      state: {
        empresas: [{ __bbt_deleted_record_key: 'id:company-a' }],
      },
    })).toBe(true)
    expect(hasAcceptedStorageMutation('bbt-atendimentos', [])).toBe(false)
    expect(hasAcceptedStorageMutation('bbt-atendimentos', [{ id: 'demand-a' }])).toBe(true)
    expect(hasAcceptedStorageMutation(
      'bbt-atendimentos',
      [{ id: 'demand-a', empresa_id: 'company-a' }],
      [{ id: 'demand-a', empresa_id: 'company-a' }],
    )).toBe(false)
    expect(hasAcceptedStorageMutation(
      'bbt-atendimentos',
      [{ id: 'demand-a', empresa_id: 'company-a', status: 'novo' }],
      [{ id: 'demand-a', empresa_id: 'company-a' }],
    )).toBe(true)
  })

  it('nao transforma o papel visual master em administrador do storage', () => {
    const user = corporateUser()
    user.role = 'master'
    user.role_key = 'agent'

    expect(isRestrictedStorageUser(user)).toBe(true)
    expect(isRestrictedStorageUser({ ...user, role_key: 'tenant_admin' })).toBe(true)
    expect(isRestrictedStorageUser({ ...user, platform_admin: true })).toBe(false)
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

  it('nao permite mover empresa administravel para grupo fora do escopo', () => {
    const groupAdminPermissions = permissionsForCorporateProfile('group_admin', {})
    const user = corporateUser()
    user.corporate_access = {
      ...user.corporate_access!,
      companyIds: ['company-a'],
      groupIds: ['group-a'],
      companies: [{
        companyId: 'company-a',
        companyName: 'Empresa A',
        groupId: 'group-a',
        groupName: 'Grupo A',
        sources: ['group_selected'],
        profiles: ['group_admin'],
        permissions: groupAdminPermissions,
      }],
      groups: [{
        groupId: 'group-a',
        groupName: 'Grupo A',
        companyIds: ['company-a'],
        canViewConsolidated: true,
        accessModes: ['selected_companies'],
        profiles: ['group_admin'],
      }],
    }
    const referenceCompany = { ...empresas[0], grupo_id: 'group-a' }
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas: [referenceCompany],
          gruposEmpresariais: [
            { id: 'group-a', nome: 'Grupo A', ativo: true, empresa_ids: ['company-a'] },
            { id: 'group-b', nome: 'Grupo B', ativo: true, empresa_ids: [] },
          ],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }

    const writable = scopeStorageEntriesForWrite({
      'bbt-data-v4': {
        state: {
          ...reference['bbt-data-v4'].state,
          empresas: [{ ...referenceCompany, nome: 'Nome permitido', grupo_id: 'group-b' }],
        },
      },
    }, reference, user) as any

    expect(writable['bbt-data-v4'].state.empresas).toEqual([{
      ...referenceCompany,
      nome: 'Nome permitido',
    }])
  })

  it('permite ao supervisor criar empresa sem autorizar alteracao ou exclusao de empresa existente', () => {
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas,
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const next = {
      'bbt-data-v4': {
        state: {
          empresas: [
            { ...empresas[0], nome: 'Alteracao indevida' },
            { id: 'company-new', nome: 'Empresa nova', cnpj: '3', ativa: true },
          ],
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const patch = createStorageSyncValue('bbt-data-v4', reference['bbt-data-v4'], next['bbt-data-v4'])
    const writable = scopeStorageEntriesForWrite({ 'bbt-data-v4': patch }, reference, internalUser('supervisor'))
    const merged = mergeStorageValues('bbt-data-v4', reference['bbt-data-v4'], writable['bbt-data-v4']) as any

    expect(merged.state.empresas.map((empresa: Empresa) => empresa.id)).toEqual([
      'company-a',
      'company-b',
      'company-new',
    ])
    expect(merged.state.empresas.find((empresa: Empresa) => empresa.id === 'company-a').nome).toBe('Empresa A')
  })

  it('mantem cadastro interno quando a sessao hidratada possui resumo tenant-wide', () => {
    const user = internalUser('supervisor')
    user.empresa_ids = empresas.map((empresa) => empresa.id)
    user.corporate_access = {
      tenantWide: true,
      companyIds: user.empresa_ids,
      groupIds: [],
      companies: empresas.map((empresa) => ({
        companyId: empresa.id,
        companyName: empresa.nome,
        groupId: null,
        groupName: null,
        sources: ['legacy_unscoped'],
        profiles: ['manager'],
        permissions: user.permissoes!,
      })),
      groups: [],
      contexts: [],
      defaultContext: { type: 'company', id: empresas[0].id },
      refreshedAt: new Date(0).toISOString(),
    }
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas,
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const incoming = {
      'bbt-data-v4': {
        state: {
          ...reference['bbt-data-v4'].state,
          empresas: [{ id: 'company-new', nome: 'Empresa nova', cnpj: '3', ativa: true }],
        },
      },
    }

    const writable = scopeStorageEntriesForWrite(incoming, reference, user) as any
    expect(writable['bbt-data-v4'].state.empresas).toEqual(incoming['bbt-data-v4'].state.empresas)
  })

  it('ao cadastrar empresa no grupo sem gerencia preserva todos os demais campos do grupo', () => {
    const group = {
      id: 'group-a',
      nome: 'Grupo original',
      ativo: true,
      empresa_ids: ['company-a'],
    }
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas: [{ ...empresas[0], grupo_id: group.id }],
          gruposEmpresariais: [group],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const incoming = {
      'bbt-data-v4': {
        state: {
          ...reference['bbt-data-v4'].state,
          empresas: [{
            id: 'company-new',
            nome: 'Empresa nova',
            cnpj: '3',
            ativa: true,
            grupo_id: group.id,
          }],
          gruposEmpresariais: [{
            ...group,
            nome: 'Renomeacao indevida',
            ativo: false,
            empresa_ids: ['company-new'],
          }],
        },
      },
    }

    const writable = scopeStorageEntriesForWrite(
      incoming,
      reference,
      internalUser('supervisor'),
    ) as any

    expect(writable['bbt-data-v4'].state.gruposEmpresariais).toEqual([{
      ...group,
      empresa_ids: ['company-a', 'company-new'],
    }])
  })

  it('descarta empresa nova quando o perfil nao possui cadastrar_empresas', () => {
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas,
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const incoming = {
      'bbt-data-v4': {
        state: {
          empresas: [{ id: 'company-new', nome: 'Empresa nova', cnpj: '3', ativa: true }],
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const writable = scopeStorageEntriesForWrite(incoming, reference, internalUser('operacional')) as any

    expect(writable['bbt-data-v4'].state.empresas).toEqual([])
  })

  it('aplica update e tombstone de empresa somente com permissao personalizada de gestao', () => {
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas,
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const next = {
      'bbt-data-v4': {
        state: {
          empresas: [{ ...empresas[0], nome: 'Empresa atualizada' }],
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const patch = createStorageSyncValue('bbt-data-v4', reference['bbt-data-v4'], next['bbt-data-v4'])
    const writable = scopeStorageEntriesForWrite(
      { 'bbt-data-v4': patch },
      reference,
      internalUser('supervisor', { gerenciar_empresas_grupo: true }),
    )
    const merged = mergeStorageValues('bbt-data-v4', reference['bbt-data-v4'], writable['bbt-data-v4']) as any

    expect(merged.state.empresas).toEqual([{ ...empresas[0], nome: 'Empresa atualizada' }])
  })

  it('permite ao supervisor criar, alterar e excluir hoteis', () => {
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas,
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [{ id: 'hotel-a', nome: 'Hotel A' }],
          politicas: [],
        },
      },
    }
    const next = {
      'bbt-data-v4': {
        state: {
          empresas,
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [
            { id: 'hotel-a', nome: 'Hotel atualizado' },
            { id: 'hotel-new', nome: 'Hotel novo' },
          ],
          politicas: [],
        },
      },
    }
    const updatePatch = createStorageSyncValue('bbt-data-v4', reference['bbt-data-v4'], next['bbt-data-v4'])
    const writableUpdate = scopeStorageEntriesForWrite(
      { 'bbt-data-v4': updatePatch },
      reference,
      internalUser('supervisor'),
    )
    const updated = mergeStorageValues('bbt-data-v4', reference['bbt-data-v4'], writableUpdate['bbt-data-v4']) as any
    expect(updated.state.hoteis).toEqual([
      { id: 'hotel-a', nome: 'Hotel atualizado' },
      { id: 'hotel-new', nome: 'Hotel novo' },
    ])

    const withoutHotels = {
      ...updated,
      state: { ...updated.state, hoteis: [] },
    }
    const deletePatch = createStorageSyncValue('bbt-data-v4', updated, withoutHotels)
    const writableDelete = scopeStorageEntriesForWrite(
      { 'bbt-data-v4': deletePatch },
      { 'bbt-data-v4': updated },
      internalUser('supervisor'),
    )
    const deleted = mergeStorageValues('bbt-data-v4', updated, writableDelete['bbt-data-v4']) as any
    expect(deleted.state.hoteis).toEqual([])
  })

  it('preserva tombstone autorizado de funcionario', () => {
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas,
          gruposEmpresariais: [],
          funcionarios: [{ id: 'employee-a', company_id: 'company-a', nome: 'Funcionario A' }],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const next = {
      'bbt-data-v4': {
        state: {
          ...reference['bbt-data-v4'].state,
          funcionarios: [],
        },
      },
    }
    const patch = createStorageSyncValue('bbt-data-v4', reference['bbt-data-v4'], next['bbt-data-v4'])
    const writable = scopeStorageEntriesForWrite({ 'bbt-data-v4': patch }, reference, internalUser('agente'))
    const merged = mergeStorageValues('bbt-data-v4', reference['bbt-data-v4'], writable['bbt-data-v4']) as any

    expect(merged.state.funcionarios).toEqual([])
  })

  it('bloqueia criacao de empresa por usuario corporativo mesmo com permissao forjada', () => {
    const user = corporateUser()
    user.permissoes = {
      ...user.permissoes!,
      cadastrar_empresas: true,
      gerenciar_empresas_grupo: true,
    }
    user.corporate_access!.companies[0].permissions.cadastrar_empresas = true
    user.corporate_access!.companies[0].permissions.gerenciar_empresas_grupo = true
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas,
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const incoming = {
      'bbt-data-v4': {
        state: {
          empresas: [{ id: 'company-new', nome: 'Empresa nova', cnpj: '3', ativa: true }],
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }

    const writable = scopeStorageEntriesForWrite(incoming, reference, user) as any
    expect(writable['bbt-data-v4'].state.empresas).toEqual([])
  })

  it('bloqueia escrita de hotel sem cadastrar_hoteis', () => {
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas,
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const incoming = {
      'bbt-data-v4': {
        state: {
          ...reference['bbt-data-v4'].state,
          hoteis: [{ id: 'hotel-new', nome: 'Hotel novo' }],
        },
      },
    }

    const writable = scopeStorageEntriesForWrite(incoming, reference, internalUser('operacional')) as any
    expect(writable['bbt-data-v4'].state.hoteis).toEqual([])
  })

  it('descarta tombstone desconhecido e bloqueia exclusao integral de grupo com escopo parcial', () => {
    const groupAdminPermissions = permissionsForCorporateProfile('group_admin', {})
    const viewerPermissions = permissionsForCorporateProfile('viewer', {})
    const user = corporateUser()
    user.corporate_access = {
      ...user.corporate_access!,
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
    const next = {
      'bbt-data-v4': {
        state: {
          ...reference['bbt-data-v4'].state,
          gruposEmpresariais: [],
        },
      },
    }
    const patch = createStorageSyncValue('bbt-data-v4', reference['bbt-data-v4'], next['bbt-data-v4']) as any
    patch.state.empresas.push({ __bbt_deleted_record_key: 'id:unknown-company' })

    const writable = scopeStorageEntriesForWrite({ 'bbt-data-v4': patch }, reference, user) as any
    expect(writable['bbt-data-v4'].state.gruposEmpresariais).toEqual([])
    expect(writable['bbt-data-v4'].state.empresas).not.toContainEqual({
      __bbt_deleted_record_key: 'id:unknown-company',
    })

    const merged = mergeStorageValues('bbt-data-v4', reference['bbt-data-v4'], writable['bbt-data-v4']) as any
    expect(merged.state.gruposEmpresariais).toEqual(reference['bbt-data-v4'].state.gruposEmpresariais)
  })

  it('separa cadastro de funcionario da alteracao e exclusao de registros existentes', () => {
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas,
          gruposEmpresariais: [],
          funcionarios: [
            { id: 'employee-update', company_id: 'company-a', nome: 'Original' },
            { id: 'employee-delete', company_id: 'company-a', nome: 'Preservar' },
          ],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const next = {
      'bbt-data-v4': {
        state: {
          ...reference['bbt-data-v4'].state,
          funcionarios: [
            { id: 'employee-update', company_id: 'company-a', nome: 'Alterado' },
            { id: 'employee-new', company_id: 'company-a', nome: 'Novo' },
          ],
        },
      },
    }
    const patch = createStorageSyncValue('bbt-data-v4', reference['bbt-data-v4'], next['bbt-data-v4'])
    const createOnly = internalUser('operacional', {
      cadastrar_funcionarios: true,
      gerenciar_funcionarios: false,
    })
    const writableCreate = scopeStorageEntriesForWrite({ 'bbt-data-v4': patch }, reference, createOnly)
    const created = mergeStorageValues('bbt-data-v4', reference['bbt-data-v4'], writableCreate['bbt-data-v4']) as any

    expect(created.state.funcionarios).toEqual([
      { id: 'employee-update', company_id: 'company-a', nome: 'Original' },
      { id: 'employee-delete', company_id: 'company-a', nome: 'Preservar' },
      { id: 'employee-new', company_id: 'company-a', nome: 'Novo' },
    ])

    const manageOnly = internalUser('operacional', {
      cadastrar_funcionarios: false,
      gerenciar_funcionarios: true,
    })
    const writableManage = scopeStorageEntriesForWrite({ 'bbt-data-v4': patch }, reference, manageOnly)
    const managed = mergeStorageValues('bbt-data-v4', reference['bbt-data-v4'], writableManage['bbt-data-v4']) as any

    expect(managed.state.funcionarios).toEqual([
      { id: 'employee-update', company_id: 'company-a', nome: 'Alterado' },
    ])
  })

  it('exige excluir_demandas para aceitar tombstone de atendimento', () => {
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas,
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
      'bbt-atendimentos': [
        { id: 'demand-a', empresa_id: 'company-a', passageiro_nome: 'Pessoa' },
      ],
    }
    const deletion = createStorageSyncValue(
      'bbt-atendimentos',
      reference['bbt-atendimentos'],
      [],
    )
    const createOnly = scopeStorageEntriesForWrite(
      { 'bbt-atendimentos': deletion },
      reference,
      internalUser('agente'),
    )
    expect(mergeStorageValues(
      'bbt-atendimentos',
      reference['bbt-atendimentos'],
      createOnly['bbt-atendimentos'],
    )).toEqual(reference['bbt-atendimentos'])

    const canDelete = scopeStorageEntriesForWrite(
      { 'bbt-atendimentos': deletion },
      reference,
      internalUser('agente', { excluir_demandas: true }),
    )
    expect(mergeStorageValues(
      'bbt-atendimentos',
      reference['bbt-atendimentos'],
      canDelete['bbt-atendimentos'],
    )).toEqual([])
  })

  it('restringe alterar_configuracoes ao campo config_cobranca e nao autoriza tombstone', () => {
    const configOriginal = {
      aplicar_markup: true,
      markup_padrao_pct: 18,
      aplicar_taxa: true,
      taxa_padrao_pct: 7,
      taxa_fixa_ativa: false,
      taxa_valor_fixo: 0,
      observacoes: 'Contrato original',
    }
    const configAtualizada = { ...configOriginal, markup_padrao_pct: 22 }
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas: [{ ...empresas[0], config_cobranca: configOriginal }],
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const user = corporateUser()
    user.corporate_access = {
      ...user.corporate_access!,
      companyIds: ['company-a'],
      companies: [{
        ...user.corporate_access!.companies[0],
        permissions: {
          ...user.corporate_access!.companies[0].permissions,
          alterar_configuracoes: true,
          gerenciar_empresas_grupo: false,
        },
      }],
    }

    const visible = scopeStorageEntriesForRead(reference, user) as any
    expect(visible['bbt-data-v4'].state.empresas[0].config_cobranca).toEqual(configOriginal)

    const writable = scopeStorageEntriesForWrite({
      'bbt-data-v4': {
        state: {
          empresas: [{
            ...reference['bbt-data-v4'].state.empresas[0],
            nome: 'Nome indevido',
            config_cobranca: configAtualizada,
          }],
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }, reference, user) as any
    expect(writable['bbt-data-v4'].state.empresas[0]).toEqual({
      ...reference['bbt-data-v4'].state.empresas[0],
      config_cobranca: configAtualizada,
    })

    const deletion = createStorageSyncValue(
      'bbt-data-v4',
      reference['bbt-data-v4'],
      { state: { ...reference['bbt-data-v4'].state, empresas: [] } },
    )
    const writableDeletion = scopeStorageEntriesForWrite({ 'bbt-data-v4': deletion }, reference, user)
    const merged = mergeStorageValues(
      'bbt-data-v4',
      reference['bbt-data-v4'],
      writableDeletion['bbt-data-v4'],
    ) as any
    expect(merged.state.empresas).toEqual(reference['bbt-data-v4'].state.empresas)
  })

  it('respeita overrides negativos do tenant_admin e mantem bypass exclusivo do platform admin', () => {
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas,
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const incoming = {
      'bbt-data-v4': {
        state: {
          ...reference['bbt-data-v4'].state,
          empresas: [
            { ...empresas[0], nome: 'Alteracao bloqueada' },
            { id: 'company-new', nome: 'Nova bloqueada', cnpj: '3', ativa: true },
          ],
        },
      },
    }
    const tenantAdmin = internalUser('lider', {
      cadastrar_empresas: false,
      gerenciar_empresas_grupo: false,
      alterar_configuracoes: false,
    })
    const scoped = scopeStorageEntriesForWrite(incoming, reference, tenantAdmin) as any
    expect(scoped['bbt-data-v4'].state.empresas).toEqual([])

    const platformAdmin = { ...tenantAdmin, platform_admin: true }
    expect(scopeStorageEntriesForWrite(incoming, reference, platformAdmin)).toBe(incoming)
  })

  it('impede troca do id de registro persistido mesmo quando a chave canonica permanece igual', () => {
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas: [empresas[0]],
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
      'bbt-atendimentos': [{
        id: 'demand-original',
        fingerprint: 'stable-demand',
        empresa_id: 'company-a',
      }],
    }
    const user = internalUser('supervisor', { gerenciar_empresas_grupo: true })
    const writable = scopeStorageEntriesForWrite({
      'bbt-data-v4': {
        state: {
          ...reference['bbt-data-v4'].state,
          empresas: [{ ...empresas[0], id: 'company-renamed' }],
        },
      },
      'bbt-atendimentos': [{
        id: 'demand-renamed',
        fingerprint: 'stable-demand',
        empresa_id: 'company-a',
      }],
    }, reference, user) as any

    expect(writable['bbt-data-v4'].state.empresas).toEqual([])
    expect(writable['bbt-atendimentos']).toEqual([])
  })

  it('preserva registros financeiros de empresas fora do escopo durante escrita', () => {
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas,
          gruposEmpresariais: [],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
      'bbt-corporate-finance': {
        carteiras: [
          { id: 'wallet-a', company_id: 'company-a', saldo: 100 },
          { id: 'wallet-b', company_id: 'company-b', saldo: 200 },
        ],
        cartoes: [
          { id: 'card-a', company_id: 'company-a' },
          { id: 'card-b', company_id: 'company-b' },
        ],
        movimentos: [],
        faturas: [],
      },
    }
    const user = corporateUser()
    const writable = scopeStorageEntriesForWrite({
      'bbt-corporate-finance': {
        carteiras: [{ id: 'wallet-b', company_id: 'company-b', saldo: 250 }],
        movimentos: [],
        faturas: [],
      },
    }, reference, user)
    const merged = mergeStorageValues(
      'bbt-corporate-finance',
      reference['bbt-corporate-finance'],
      writable['bbt-corporate-finance'],
    ) as any

    expect(merged.carteiras).toEqual([
      { id: 'wallet-a', company_id: 'company-a', saldo: 100 },
      { id: 'wallet-b', company_id: 'company-b', saldo: 250 },
    ])
    expect(merged.cartoes).toEqual(reference['bbt-corporate-finance'].cartoes)
  })

  it('permite ao group_admin criar empresa somente em grupo all_companies administravel', () => {
    const groupPermissions = permissionsForCorporateProfile('group_admin', {})
    const user = corporateUser()
    user.corporate_profile = 'group_admin'
    user.permissoes = groupPermissions
    user.corporate_access = {
      ...user.corporate_access!,
      companyIds: ['company-a'],
      groupIds: ['group-a'],
      companies: [{
        companyId: 'company-a',
        companyName: 'Empresa A',
        groupId: 'group-a',
        groupName: 'Grupo A',
        sources: ['group_all'],
        profiles: ['group_admin'],
        permissions: groupPermissions,
      }],
      groups: [{
        groupId: 'group-a',
        groupName: 'Grupo A',
        companyIds: ['company-a'],
        canViewConsolidated: true,
        accessModes: ['all_companies'],
        profiles: ['group_admin'],
      }],
    }
    const group = {
      id: 'group-a',
      nome: 'Grupo A',
      ativo: true,
      empresa_ids: ['company-a'],
    }
    const reference = {
      'bbt-data-v4': {
        state: {
          empresas: [{ ...empresas[0], grupo_id: 'group-a' }],
          gruposEmpresariais: [group],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const incoming = {
      'bbt-data-v4': {
        state: {
          empresas: [{
            id: 'company-new',
            nome: 'Empresa nova',
            cnpj: '3',
            ativa: true,
            grupo_id: 'group-a',
          }],
          gruposEmpresariais: [{ ...group, empresa_ids: ['company-a', 'company-new'] }],
          funcionarios: [],
          hoteis: [],
          politicas: [],
        },
      },
    }
    const writable = scopeStorageEntriesForWrite(incoming, reference, user) as any
    expect(writable['bbt-data-v4'].state.empresas).toEqual(incoming['bbt-data-v4'].state.empresas)
    expect(writable['bbt-data-v4'].state.gruposEmpresariais[0].empresa_ids).toEqual([
      'company-a',
      'company-new',
    ])

    user.corporate_access = {
      ...user.corporate_access!,
      companies: [{
        ...user.corporate_access!.companies[0],
        sources: ['group_selected'],
      }],
      groups: [{
        ...user.corporate_access!.groups[0],
        accessModes: ['selected_companies'],
      }],
    }
    const blocked = scopeStorageEntriesForWrite(incoming, reference, user) as any
    expect(blocked['bbt-data-v4'].state.empresas).toEqual([])
  })
})
