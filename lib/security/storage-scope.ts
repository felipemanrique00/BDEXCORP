import { empresasPermitidasParaUsuario, hasScopedAccess } from '@/lib/grupos'
import { SYSTEM_STORAGE_META_KEY } from '@/lib/storage-keys'
import type { Empresa, GrupoEmpresarial, User } from '@/types'

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
  return !user || user.role !== 'master' || hasScopedAccess(user)
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
  const externalCompanyUser = !user || user.role !== 'master'
  const scoped: StorageEntries = {}

  for (const [key, value] of Object.entries(source)) {
    if (key === SYSTEM_STORAGE_META_KEY) {
      if (mode === 'read') scoped[key] = value
      continue
    }
    if (key === 'bbt-data-v4') {
      scoped[key] = scopePersistedStore(value, allowedIds, grupos, mode, externalCompanyUser)
      continue
    }
    if (key === 'bbt-corporate-finance') {
      scoped[key] = scopeCorporateFinance(value, allowedIds)
      continue
    }
    if (SCOPED_ARRAY_KEYS.has(key) && Array.isArray(value)) {
      if (externalCompanyUser && mode === 'write' && key === 'bbt-financeiro') continue
      const filtered = value.filter((item) => allowedIds.has(companyIdOf(item)))
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
): unknown {
  const wrapped = isRecord(value) && isRecord(value.state)
  const state = getPersistedState(value)
  const scopedGroups = grupos
    .filter((grupo) => grupo.empresa_ids.some((empresaId) => allowedIds.has(empresaId)))
    .map((grupo) => ({ ...grupo, empresa_ids: grupo.empresa_ids.filter((empresaId) => allowedIds.has(empresaId)) }))
  const scopedState = {
    ...state,
    empresas: arrayOf<Empresa>(state.empresas)
      .filter((empresa) => allowedIds.has(empresa.id))
      .map((empresa) => externalCompanyUser ? withoutKeys(empresa, ['config_cobranca']) : empresa),
    gruposEmpresariais: scopedGroups,
    funcionarios: arrayOf<JsonRecord>(state.funcionarios).filter((item) => allowedIds.has(companyIdOf(item))),
    hoteis: mode === 'read'
      ? arrayOf<JsonRecord>(state.hoteis).map((hotel) => externalCompanyUser ? scopeExternalHotel(hotel) : hotel)
      : [],
    politicas: arrayOf<JsonRecord>(state.politicas).filter((item) => allowedIds.has(companyIdOf(item))),
  }

  if (!wrapped) return scopedState
  return { ...(value as JsonRecord), state: scopedState }
}

function scopeExternalCompanyArray(key: string, items: unknown[], mode: 'read' | 'write'): unknown[] {
  if (key === 'bbt-financeiro') {
    return mode === 'read'
      ? items.filter((item) => isRecord(item) && item.tipo === 'receber')
      : []
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
