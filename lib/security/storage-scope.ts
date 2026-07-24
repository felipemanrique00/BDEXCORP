import { empresasPermitidasParaUsuario } from '@/lib/grupos'
import { SYSTEM_STORAGE_META_KEY } from '@/lib/storage-keys'
import type { Empresa, GrupoEmpresarial, Permissoes, User } from '@/types'

type StorageEntries = Record<string, unknown>
type JsonRecord = Record<string, any>

const SCOPED_ARRAY_KEYS = new Set([
  'bbt-atendimentos',
  'bbt-vouchers-emitidos',
  'bbt-vouchers-gerados',
  'bbt-emissoes',
  'bbt-financeiro',
  'bbt-aprovacoes',
  'bbt-transferencias',
  'bbt-alertas',
  'bbt-caixa-entrada',
  'bbt-fila-importacao',
  'bbt-solicitantes-empresa',
])

export function isRestrictedStorageUser(user: User | null): boolean {
  return !isTenantStorageAdministrator(user)
}

export function scopeStorageEntriesForRead(entries: StorageEntries, user: User | null): StorageEntries {
  if (!isRestrictedStorageUser(user)) return entries
  return scopeEntries(entries, entries, user, 'read')
}

export function scopeStorageEntriesForWrite(
  incoming: StorageEntries,
  referenceEntries: StorageEntries,
  user: User | null,
): StorageEntries {
  if (!isRestrictedStorageUser(user)) return incoming
  return scopeEntries(incoming, referenceEntries, user, 'write')
}

function scopeEntries(
  source: StorageEntries,
  referenceEntries: StorageEntries,
  user: User | null,
  mode: 'read' | 'write',
): StorageEntries {
  const referenceState = getPersistedState(referenceEntries['bbt-data-v4'])
  const empresas = arrayOf<Empresa>(referenceState.empresas)
  const grupos = arrayOf<GrupoEmpresarial>(referenceState.gruposEmpresariais)
  const allowedIds = new Set(empresasPermitidasParaUsuario(user, empresas, grupos).map((empresa) => empresa.id))
  const externalCompanyUser = !isAgencyInternalUser(user)
  const scoped: StorageEntries = {}

  for (const [key, value] of Object.entries(source)) {
    if (key === SYSTEM_STORAGE_META_KEY) {
      if (mode === 'read') scoped[key] = value
      continue
    }
    if (key === 'bbt-data-v4') {
      scoped[key] = scopePersistedStore(value, allowedIds, grupos, mode, externalCompanyUser, user)
      continue
    }
    if (key === 'bbt-corporate-finance') {
      const financeIds = companyIdsForPermission(user, allowedIds, mode === 'read' ? 'ver_financeiro' : 'editar_financeiro')
      scoped[key] = scopeCorporateFinance(value, financeIds)
      continue
    }
    if (SCOPED_ARRAY_KEYS.has(key) && Array.isArray(value)) {
      const permission = storagePermission(key, mode)
      const permittedIds = permission ? companyIdsForPermission(user, allowedIds, permission) : allowedIds
      if (mode === 'write' && externalCompanyUser && !permission) continue
      if (mode === 'write' && externalCompanyUser && permission && permittedIds.size === 0) continue
      const filtered = value.filter((item) => permittedIds.has(companyIdOf(item)))
      scoped[key] = externalCompanyUser
        ? scopeExternalCompanyArray(key, filtered, mode)
        : filtered
    }
  }

  return scoped
}

function scopePersistedStore(
  value: unknown,
  allowedIds: Set<string>,
  grupos: GrupoEmpresarial[],
  mode: 'read' | 'write',
  externalCompanyUser: boolean,
  user: User | null,
): unknown {
  const wrapped = isRecord(value) && isRecord(value.state)
  const state = getPersistedState(value)
  const companyReadIds = companyIdsForPermission(user, allowedIds, 'ver_empresas')
  const employeeIds = companyIdsForPermission(
    user,
    allowedIds,
    mode === 'read' ? 'ver_funcionarios' : 'gerenciar_funcionarios',
    mode === 'write' ? 'cadastrar_funcionarios' : undefined,
  )
  const policyIds = companyIdsForPermission(user, allowedIds, mode === 'read' ? 'ver_empresas' : 'editar_politicas')
  const companyMutationIds = companyIdsForPermission(
    user,
    allowedIds,
    'gerenciar_empresas_grupo',
    'cadastrar_empresas',
  )
  const visibleCompanyIds = mode === 'read' ? companyReadIds : companyMutationIds
  const sourceGroups = arrayOf<GrupoEmpresarial>(state.gruposEmpresariais)
  const scopedGroups = sourceGroups
    .filter((grupo) => {
      const reference = grupos.find((item) => item.id === grupo.id)
      return [...grupo.empresa_ids, ...(reference?.empresa_ids || [])]
        .some((empresaId) => visibleCompanyIds.has(empresaId))
    })
    .map((grupo) => {
      if (mode === 'read') {
        return { ...grupo, empresa_ids: grupo.empresa_ids.filter((empresaId) => visibleCompanyIds.has(empresaId)) }
      }
      const reference = grupos.find((item) => item.id === grupo.id)
      const preservedIds = (reference?.empresa_ids || []).filter((empresaId) => !visibleCompanyIds.has(empresaId))
      const requestedIds = grupo.empresa_ids.filter((empresaId) => visibleCompanyIds.has(empresaId))
      return { ...grupo, empresa_ids: Array.from(new Set([...preservedIds, ...requestedIds])) }
    })
  const scopedState = {
    ...state,
    empresas: arrayOf<Empresa>(state.empresas)
      .filter((empresa) => visibleCompanyIds.has(empresa.id))
      .map((empresa) => externalCompanyUser ? withoutKeys(empresa, ['config_cobranca']) : empresa),
    gruposEmpresariais: scopedGroups,
    funcionarios: arrayOf<JsonRecord>(state.funcionarios).filter((item) => employeeIds.has(companyIdOf(item))),
    hoteis: mode === 'read'
      ? arrayOf<JsonRecord>(state.hoteis).map((hotel) => externalCompanyUser ? scopeExternalHotel(hotel) : hotel)
      : [],
    politicas: arrayOf<JsonRecord>(state.politicas).filter((item) => policyIds.has(companyIdOf(item))),
  }

  if (!wrapped) return scopedState
  return { ...(value as JsonRecord), state: scopedState }
}

function scopeExternalCompanyArray(key: string, items: unknown[], mode: 'read' | 'write'): unknown[] {
  if (key === 'bbt-financeiro') {
    return items.filter((item) => isRecord(item) && item.tipo === 'receber')
  }

  if (key === 'bbt-atendimentos') {
    return items.map((item) => withoutKeys(item, [
      'valor_custo',
      'markup_valor',
      'markup_desabilitado',
      'wintour_dados',
      'observacoes_internas',
      'historico_agentes',
      'repassada_de',
      'repassada_para',
      'motivo_repasse',
    ]))
  }

  if (key === 'bbt-vouchers-emitidos' || key === 'bbt-vouchers-gerados' || key === 'bbt-emissoes') {
    return items.map((item) => withoutKeys(item, [
      'valor_custo',
      'markup_valor',
      'lucro',
      'margem',
      'wintour_dados',
      'observacoes_internas',
      'raw',
    ]))
  }

  return items
}

function scopeExternalHotel(hotel: JsonRecord): JsonRecord {
  return {
    id: hotel.id,
    nome: hotel.nome,
    cidade: hotel.cidade,
    uf: hotel.uf,
    categoria: hotel.categoria,
    observacoes: null,
    telefone: null,
    faturado: false,
    info_faturamento: null,
    bebedouro: hotel.bebedouro ?? null,
    valor_agua: null,
    cafe_manha: hotel.cafe_manha ?? null,
    estacionamento: hotel.estacionamento ?? null,
    tarifa_sgl: null,
    tarifa_dbl: null,
    tarifa_tpl: null,
    formas_pagamento: [],
  }
}

function withoutKeys(value: unknown, keys: string[]): JsonRecord {
  if (!isRecord(value)) return {}
  const copy = { ...value }
  keys.forEach((key) => delete copy[key])
  return copy
}

function scopeCorporateFinance(value: unknown, allowedIds: Set<string>): unknown {
  if (!isRecord(value)) return { carteiras: [], cartoes: [], movimentos: [], faturas: [] }
  return {
    ...value,
    carteiras: filterCompanyArray(value.carteiras, allowedIds),
    cartoes: filterCompanyArray(value.cartoes, allowedIds),
    movimentos: filterCompanyArray(value.movimentos, allowedIds),
    faturas: filterCompanyArray(value.faturas, allowedIds),
  }
}

function filterCompanyArray(value: unknown, allowedIds: Set<string>): JsonRecord[] {
  return arrayOf<JsonRecord>(value).filter((item) => allowedIds.has(companyIdOf(item)))
}

function storagePermission(key: string, mode: 'read' | 'write'): keyof Permissoes | null {
  if (key === 'bbt-atendimentos' || key === 'bbt-caixa-entrada' || key === 'bbt-fila-importacao') {
    return mode === 'read' ? 'ver_demandas' : 'criar_demandas'
  }
  if (key === 'bbt-vouchers-emitidos' || key === 'bbt-vouchers-gerados') {
    return mode === 'read' ? 'ver_vouchers' : null
  }
  if (key === 'bbt-emissoes') return mode === 'read' ? 'ver_emissoes' : null
  if (key === 'bbt-financeiro') return mode === 'read' ? 'ver_financeiro' : 'editar_financeiro'
  if (key === 'bbt-aprovacoes') return mode === 'read' ? 'ver_demandas' : 'aprovar_demandas'
  if (key === 'bbt-transferencias' || key === 'bbt-alertas') return mode === 'read' ? 'ver_demandas' : null
  if (key === 'bbt-solicitantes-empresa') return mode === 'read' ? 'ver_solicitantes' : 'gerenciar_solicitantes'
  return null
}

function companyIdsForPermission(
  user: User | null,
  allowedIds: Set<string>,
  permission: keyof Permissoes,
  alternative?: keyof Permissoes,
): Set<string> {
  if (!user) return new Set()
  if (user.corporate_access) {
    return new Set(user.corporate_access.companies
      .filter((company) => company.permissions[permission] || Boolean(alternative && company.permissions[alternative]))
      .map((company) => company.companyId)
      .filter((companyId) => allowedIds.has(companyId)))
  }
  // Cadastros anteriores ao RBAC corporativo nao persistiam um mapa de permissoes.
  if (user.role === 'company_admin' && !user.permissoes) {
    return permission === 'editar_financeiro' ? new Set() : new Set(allowedIds)
  }
  if (user.permissoes?.[permission] || (alternative && user.permissoes?.[alternative])) {
    return new Set(allowedIds)
  }
  return new Set()
}

function isTenantStorageAdministrator(user: User | null): boolean {
  return Boolean(user && (user.platform_admin || user.role_key === 'tenant_admin'))
}

function isAgencyInternalUser(user: User | null): boolean {
  return Boolean(user && (
    user.platform_admin
    || ['tenant_admin', 'agent', 'financial_manager', 'supervisor', 'operator'].includes(user.role_key || '')
  ))
}

function getPersistedState(value: unknown): JsonRecord {
  if (!isRecord(value)) return {}
  return isRecord(value.state) ? value.state : value
}

function companyIdOf(value: unknown): string {
  if (!isRecord(value)) return ''
  return String(value.empresa_id || value.company_id || '').trim()
}

function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
