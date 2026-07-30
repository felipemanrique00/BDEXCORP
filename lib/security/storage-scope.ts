import {
  canCreateCompanyForGroup,
  isTenantWideAgencyUser,
} from '@/lib/company-creation-access'
import { empresasPermitidasParaUsuario } from '@/lib/grupos'
import {
  getStorageDeleteRecordKey,
  mergeStorageValues,
  storageRecordKey,
} from '@/lib/storage-merge'
import { SYSTEM_STORAGE_META_KEY } from '@/lib/storage-keys'
import { PERMISSOES_PADRAO_POR_PERFIL } from '@/types'
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

export function hasAcceptedStorageMutation(
  key: string,
  value: unknown,
  referenceValue?: unknown,
): boolean {
  if (referenceValue !== undefined) {
    return JSON.stringify(mergeStorageValues(key, referenceValue, value))
      !== JSON.stringify(referenceValue)
  }
  if (key === 'bbt-data-v4') {
    const state = getPersistedState(value)
    return ['empresas', 'gruposEmpresariais', 'funcionarios', 'hoteis', 'politicas']
      .some((arrayKey) => Array.isArray(state[arrayKey]) && state[arrayKey].length > 0)
  }
  return !Array.isArray(value) || value.length > 0
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
      scoped[key] = scopePersistedStore(
        value,
        referenceState,
        allowedIds,
        grupos,
        mode,
        externalCompanyUser,
        user,
      )
      continue
    }
    if (key === 'bbt-corporate-finance') {
      const financeIds = companyIdsForPermission(user, allowedIds, mode === 'read' ? 'ver_financeiro' : 'editar_financeiro')
      scoped[key] = scopeCorporateFinance(value, referenceEntries[key], financeIds, mode)
      continue
    }
    if (SCOPED_ARRAY_KEYS.has(key) && Array.isArray(value)) {
      const permission = storagePermission(key, mode)
      const permittedIds = permission ? companyIdsForPermission(user, allowedIds, permission) : allowedIds
      const deleteIds = mode === 'write' && key === 'bbt-atendimentos'
        ? companyIdsForPermission(user, allowedIds, 'excluir_demandas')
        : permittedIds
      if (mode === 'write' && externalCompanyUser && !permission) continue
      if (
        mode === 'write'
        && externalCompanyUser
        && permission
        && permittedIds.size === 0
        && deleteIds.size === 0
      ) continue
      const referenceItems = arrayOf<unknown>(referenceEntries[key])
      let filtered = filterCompanyScopedMutations(
        value,
        referenceItems,
        permittedIds,
        mode,
        permittedIds,
        deleteIds,
      )
      if (mode === 'write' && key === 'bbt-solicitantes-empresa') {
        filtered = preserveRequesterUserLinks(
          filtered,
          referenceItems,
          companyIdsForPermission(user, allowedIds, 'gerenciar_usuarios'),
        )
      }
      scoped[key] = externalCompanyUser
        ? scopeExternalCompanyArray(key, filtered, mode, referenceItems)
        : filtered
    }
  }

  return scoped
}

function preserveRequesterUserLinks(
  items: unknown[],
  referenceItems: unknown[],
  manageableCompanyIds: Set<string>,
): unknown[] {
  return items.map((item) => {
    if (!isRecord(item) || getStorageDeleteRecordKey(item)) return item
    const reference = referenceRecordForMutation(item, referenceItems)
    const companyId = companyIdOf(reference || item)
    if (manageableCompanyIds.has(companyId)) return item
    return {
      ...item,
      user_id: isRecord(reference) ? reference.user_id ?? null : null,
    }
  })
}

function scopePersistedStore(
  value: unknown,
  referenceState: JsonRecord,
  allowedIds: Set<string>,
  grupos: GrupoEmpresarial[],
  mode: 'read' | 'write',
  externalCompanyUser: boolean,
  user: User | null,
): unknown {
  const wrapped = isRecord(value) && isRecord(value.state)
  const state = getPersistedState(value)
  const companyReadIds = companyIdsForPermission(user, allowedIds, 'ver_empresas')
  const employeeReadIds = companyIdsForPermission(user, allowedIds, 'ver_funcionarios')
  const employeeCreateIds = companyIdsForPermission(user, allowedIds, 'cadastrar_funcionarios')
  const employeeManageIds = companyIdsForPermission(user, allowedIds, 'gerenciar_funcionarios')
  const policyIds = companyIdsForPermission(user, allowedIds, mode === 'read' ? 'ver_empresas' : 'editar_politicas')
  const companyManageIds = companyIdsForPermission(user, allowedIds, 'gerenciar_empresas_grupo')
  const companyConfigIds = companyIdsForPermission(user, allowedIds, 'alterar_configuracoes')
  const groupMutationIds = companyIdsForPermission(user, allowedIds, 'gerenciar_empresas_grupo')
  const referenceCompanies = arrayOf<Empresa>(referenceState.empresas)
  const sourceCompanies = arrayOf<JsonRecord>(state.empresas)
  const createdCompanyGroups = new Map<string, string>()
  const scopedCompanies = sourceCompanies.flatMap((empresa) => {
    const companyId = String(empresa.id || '').trim()
    if (mode === 'read') return companyReadIds.has(companyId) ? [empresa] : []

    const reference = referenceRecordForMutation(empresa, referenceCompanies)
    if (getStorageDeleteRecordKey(empresa)) {
      return reference && companyManageIds.has(String(reference.id || '')) ? [empresa] : []
    }
    if (reference) {
      const referenceId = String(reference.id || '').trim()
      if (!hasSamePersistentId(empresa, reference)) return []
      if (companyManageIds.has(referenceId)) {
        const referenceGroupId = String(reference.grupo_id || '').trim()
        const requestedGroupId = Object.prototype.hasOwnProperty.call(empresa, 'grupo_id')
          ? String(empresa.grupo_id || '').trim()
          : referenceGroupId
        return requestedGroupId === referenceGroupId
          || canCreateCompanyForGroup(user, requestedGroupId, grupos)
          ? [empresa]
          : [{ ...empresa, grupo_id: reference.grupo_id ?? null }]
      }
      if (
        companyConfigIds.has(referenceId)
        && Object.prototype.hasOwnProperty.call(empresa, 'config_cobranca')
        && isRecord(empresa.config_cobranca)
      ) {
        return [{ ...reference, config_cobranca: empresa.config_cobranca }]
      }
      return []
    }
    if (!companyId || !canCreateCompanyForGroup(user, empresa.grupo_id, grupos)) return []
    const groupId = String(empresa.grupo_id || '').trim()
    if (groupId) createdCompanyGroups.set(companyId, groupId)
    return [empresa]
  })

  const sourceGroups = arrayOf<JsonRecord>(state.gruposEmpresariais)
  const canCreateGroup = mode === 'write'
    && isTenantWideAgencyInternalUser(user)
    && hasUserPermission(user, 'gerenciar_empresas_grupo')
  const scopedGroups = sourceGroups.flatMap((grupo) => {
    const reference = referenceRecordForMutation(grupo, grupos)
    const deletedKey = getStorageDeleteRecordKey(grupo)
    if (mode === 'read') {
      const companyIds = arrayOf<string>(grupo.empresa_ids)
        .filter((empresaId) => companyReadIds.has(empresaId))
      return companyIds.length ? [{ ...grupo, empresa_ids: companyIds }] : []
    }
    if (deletedKey) {
      if (!reference) return []
      const referenceCompanyIds = arrayOf<string>(reference.empresa_ids)
      return referenceCompanyIds.every((empresaId) => groupMutationIds.has(empresaId))
        && (referenceCompanyIds.length > 0 || canCreateGroup)
        ? [grupo]
        : []
    }
    if (reference && !hasSamePersistentId(grupo, reference)) return []
    if (!reference) return canCreateGroup && Boolean(String(grupo.id || '').trim()) ? [grupo] : []
    const referenceCompanyIds = arrayOf<string>(reference.empresa_ids)
    const groupId = String(grupo.id || '').trim()
    const attachesCreatedCompany = [...createdCompanyGroups.values()].includes(groupId)
    const canMutateGroup = referenceCompanyIds.some((empresaId) => groupMutationIds.has(empresaId))
      || (referenceCompanyIds.length === 0 && canCreateGroup)
    if (!canMutateGroup && !attachesCreatedCompany) return []
    const preservedIds = referenceCompanyIds.filter((empresaId) => !groupMutationIds.has(empresaId))
    const requestedIds = arrayOf<string>(grupo.empresa_ids)
      .filter((empresaId) => (
        groupMutationIds.has(empresaId)
        || createdCompanyGroups.get(empresaId) === groupId
      ))
    return [{
      ...(canMutateGroup ? grupo : reference),
      empresa_ids: Array.from(new Set([...preservedIds, ...requestedIds])),
    }]
  })

  const sourceEmployees = arrayOf<JsonRecord>(state.funcionarios)
  const referenceEmployees = arrayOf<JsonRecord>(referenceState.funcionarios)
  const sourcePolicies = arrayOf<JsonRecord>(state.politicas)
  const referencePolicies = arrayOf<JsonRecord>(referenceState.politicas)
  const sourceHotels = arrayOf<JsonRecord>(state.hoteis)
  const referenceHotels = arrayOf<JsonRecord>(referenceState.hoteis)
  const canManageHotels = mode === 'write'
    && isAgencyInternalUser(user)
    && hasUserPermission(user, 'cadastrar_hoteis')
  const scopedState = {
    ...state,
    empresas: scopedCompanies
      .map((empresa) => (
        externalCompanyUser && !companyConfigIds.has(String(empresa.id || '').trim())
          ? withoutKeys(empresa, ['config_cobranca'])
          : empresa
      )),
    gruposEmpresariais: scopedGroups,
    funcionarios: filterCompanyScopedMutations(
      sourceEmployees,
      referenceEmployees,
      mode === 'read' ? employeeReadIds : employeeCreateIds,
      mode,
      employeeManageIds,
      employeeManageIds,
    ),
    hoteis: mode === 'read'
      ? sourceHotels.map((hotel) => externalCompanyUser ? scopeExternalHotel(hotel) : hotel)
      : canManageHotels
        ? filterUnscopedMutations(sourceHotels, referenceHotels)
        : [],
    politicas: filterCompanyScopedMutations(sourcePolicies, referencePolicies, policyIds, mode),
  }

  if (!wrapped) return scopedState
  return { ...(value as JsonRecord), state: scopedState }
}

function filterCompanyScopedMutations(
  items: unknown[],
  referenceItems: unknown[],
  permittedIds: Set<string>,
  mode: 'read' | 'write',
  updateIds: Set<string> = permittedIds,
  deleteIds: Set<string> = updateIds,
): unknown[] {
  return items.filter((item) => {
    if (mode === 'read') return permittedIds.has(companyIdOf(item))
    const reference = referenceRecordForMutation(item, referenceItems)
    if (getStorageDeleteRecordKey(item)) {
      return Boolean(reference && deleteIds.has(companyIdOf(reference)))
    }
    if (!reference) return permittedIds.has(companyIdOf(item))
    if (!hasSamePersistentId(item, reference)) return false
    const originalCompanyId = companyIdOf(reference)
    const requestedCompanyId = companyIdOf(item) || originalCompanyId
    return updateIds.has(originalCompanyId) && updateIds.has(requestedCompanyId)
  })
}

function filterUnscopedMutations(items: unknown[], referenceItems: unknown[]): unknown[] {
  return items.filter((item) => {
    const reference = referenceRecordForMutation(item, referenceItems)
    if (getStorageDeleteRecordKey(item)) return Boolean(reference)
    return !reference || hasSamePersistentId(item, reference)
  })
}

function referenceRecordForMutation(item: unknown, referenceItems: unknown[]): JsonRecord | undefined {
  const deletedKey = getStorageDeleteRecordKey(item)
  if (deletedKey) {
    return referenceItems.find((reference) => storageRecordKey(reference) === deletedKey) as JsonRecord | undefined
  }
  if (!isRecord(item)) return undefined
  const id = String(item.id || '').trim()
  if (id) {
    const byId = referenceItems.find((reference) => (
      isRecord(reference) && String(reference.id || '').trim() === id
    ))
    if (isRecord(byId)) return byId
  }
  const recordKey = storageRecordKey(item)
  if (!recordKey) return undefined
  const byRecordKey = referenceItems.find((reference) => storageRecordKey(reference) === recordKey)
  return isRecord(byRecordKey) ? byRecordKey : undefined
}

function scopeExternalCompanyArray(
  key: string,
  items: unknown[],
  mode: 'read' | 'write',
  referenceItems: unknown[],
): unknown[] {
  if (key === 'bbt-financeiro') {
    return items.filter((item) => {
      const reference = mode === 'write' ? referenceRecordForMutation(item, referenceItems) : undefined
      const effective = reference || item
      return isRecord(effective) && effective.tipo === 'receber'
    })
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

function scopeCorporateFinance(
  value: unknown,
  referenceValue: unknown,
  allowedIds: Set<string>,
  mode: 'read' | 'write',
): unknown {
  const reference = isRecord(referenceValue) ? referenceValue : {}
  if (!isRecord(value)) {
    return mode === 'write'
      ? reference
      : { carteiras: [], cartoes: [], movimentos: [], faturas: [] }
  }
  if (mode === 'read') {
    return {
      ...value,
      carteiras: filterCompanyArray(value.carteiras, allowedIds),
      cartoes: filterCompanyArray(value.cartoes, allowedIds),
      movimentos: filterCompanyArray(value.movimentos, allowedIds),
      faturas: filterCompanyArray(value.faturas, allowedIds),
    }
  }
  return {
    ...reference,
    ...value,
    carteiras: scopeCorporateFinanceArrayForWrite(value.carteiras, reference.carteiras, allowedIds),
    cartoes: scopeCorporateFinanceArrayForWrite(value.cartoes, reference.cartoes, allowedIds),
    movimentos: scopeCorporateFinanceArrayForWrite(value.movimentos, reference.movimentos, allowedIds),
    faturas: scopeCorporateFinanceArrayForWrite(value.faturas, reference.faturas, allowedIds),
  }
}

function filterCompanyArray(value: unknown, allowedIds: Set<string>): JsonRecord[] {
  return arrayOf<JsonRecord>(value).filter((item) => allowedIds.has(companyIdOf(item)))
}

function scopeCorporateFinanceArrayForWrite(
  value: unknown,
  referenceValue: unknown,
  allowedIds: Set<string>,
): JsonRecord[] {
  const referenceItems = arrayOf<JsonRecord>(referenceValue)
  if (!Array.isArray(value)) return referenceItems

  const scoped: JsonRecord[] = referenceItems
    .filter((item) => !allowedIds.has(companyIdOf(item)))
  const seen = new Set(scoped.map(mutationIdentityKey))

  for (const item of arrayOf<JsonRecord>(value)) {
    const reference = referenceRecordForMutation(item, referenceItems)
    if (reference) {
      const originalCompanyId = companyIdOf(reference)
      const requestedCompanyId = companyIdOf(item) || originalCompanyId
      if (!allowedIds.has(originalCompanyId)) continue
      const accepted = hasSamePersistentId(item, reference) && allowedIds.has(requestedCompanyId)
        ? item
        : reference
      const key = mutationIdentityKey(accepted)
      if (!seen.has(key)) {
        seen.add(key)
        scoped.push(accepted)
      }
      continue
    }
    if (!allowedIds.has(companyIdOf(item))) continue
    const key = mutationIdentityKey(item)
    if (!seen.has(key)) {
      seen.add(key)
      scoped.push(item)
    }
  }

  return scoped
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
    return permission === 'editar_financeiro' || permission === 'alterar_configuracoes'
      ? new Set()
      : new Set(allowedIds)
  }
  if (user.permissoes?.[permission] || (alternative && user.permissoes?.[alternative])) {
    return new Set(allowedIds)
  }
  return new Set()
}

function isTenantStorageAdministrator(user: User | null): boolean {
  return Boolean(user?.platform_admin)
}

function isAgencyInternalUser(user: User | null): boolean {
  return Boolean(user && (
    user.platform_admin
    || ['tenant_admin', 'agent', 'financial_manager', 'supervisor', 'operator'].includes(user.role_key || '')
  ))
}

function isTenantWideAgencyInternalUser(user: User | null): boolean {
  return isAgencyInternalUser(user) && isTenantWideAgencyUser(user)
}

function hasUserPermission(user: User | null, permission: keyof Permissoes): boolean {
  if (!user || user.ativo === false) return false
  if (user.permissoes) return user.permissoes[permission]
  return user.perfil_bbt
    ? PERMISSOES_PADRAO_POR_PERFIL[user.perfil_bbt][permission]
    : false
}

function hasSamePersistentId(item: unknown, reference: unknown): boolean {
  if (!isRecord(reference)) return false
  const referenceId = String(reference.id || '').trim()
  if (!referenceId) return true
  return isRecord(item) && String(item.id || '').trim() === referenceId
}

function mutationIdentityKey(item: unknown): string {
  if (isRecord(item)) {
    const id = String(item.id || '').trim()
    if (id) return `id:${id}`
  }
  return storageRecordKey(item)
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
